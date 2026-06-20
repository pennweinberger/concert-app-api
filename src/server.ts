import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import * as Sentry from "@sentry/node";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { registerInternalRoutes } from "./routes/internal.js";
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendAccountDeleteConfirmEmail,
} from "./lib/email.js";
import {
  requestAccountDelete,
  confirmAccountDelete,
  cancelAccountDelete,
  deletionScheduledFor,
} from "./lib/accountLifecycle.js";
import {
  createComment,
  deleteComment,
  listComments,
  DEFAULT_COMMENTS_LIMIT,
  MAX_COMMENTS_LIMIT,
} from "./lib/comments.js";
import {
  searchShows,
  DEFAULT_SHOW_SEARCH_LIMIT,
  MAX_SHOW_SEARCH_LIMIT,
} from "./lib/showSearch.js";
import {
  generateTokenString,
  tokenExpiresAt,
  checkToken,
} from "./lib/tokens.js";
import {
  forgotPassword,
  resetPassword,
} from "./lib/passwordReset.js";

dotenv.config();

// Sentry must initialize before anything that might throw. SDK is a no-op
// when SENTRY_DSN_API is not set, so this is safe to ship before the env
// var is configured in Vercel.
if (process.env.SENTRY_DSN_API) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN_API,
    environment: process.env.NODE_ENV || "production",
    tracesSampleRate: 0.1,
  });
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error(
    "FATAL: JWT_SECRET env var is not set. Refusing to start.",
  );
  process.exit(1);
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { userId: string; handle: string };
    user: { userId: string; handle: string };
  }
}

const prisma = new PrismaClient();

// trustProxy: true is required on Vercel so request.ip resolves to the
// real client IP from X-Forwarded-For instead of the Vercel proxy IP
// (otherwise rate limiting would key everything off one address).
const app = Fastify({ logger: true, trustProxy: true });

app.register(cors, {
  origin: true,
  allowedHeaders: ["Content-Type", "Authorization"],
});

app.register(fastifyJwt, { secret: JWT_SECRET });

// --- Rate limiting ---------------------------------------------------------
//
// TEMPORARY: in-memory IP-based rate limiter. Each Vercel function instance
// has its own Map, so the effective limit is (instances * limit). For real
// production launch this should be replaced with a Redis/Upstash backend
// so limits are global across instances. See follow-up list.
//
// We had been using @fastify/rate-limit (v9 with Fastify 4), but its
// per-route config wasn't being applied on Vercel for reasons we couldn't
// pin down — no x-ratelimit-* headers, no 429s under burst. Replaced with
// this inline implementation since the surface area is small and the
// semantics we want (per-IP, fixed window, attach as preHandler) are
// trivial to write directly.
type RateBucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, RateBucket>();
const MAX_RATE_BUCKETS = 10_000;

function makeRateLimit(name: string, max: number, windowMs: number) {
  return async function rateLimitHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const ip = request.ip || "unknown";
    const key = `${name}:${ip}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);

    if (!bucket || bucket.resetAt < now) {
      // First request in a new window — initialize bucket.
      if (rateBuckets.size >= MAX_RATE_BUCKETS) {
        // Hard cap so a flood of unique IPs can't OOM the function. Drop
        // the entire map; next request from each IP starts a fresh window.
        rateBuckets.clear();
      }
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      reply.header("X-RateLimit-Limit", String(max));
      reply.header("X-RateLimit-Remaining", String(max - 1));
      return;
    }

    bucket.count++;
    const remaining = Math.max(0, max - bucket.count);
    reply.header("X-RateLimit-Limit", String(max));
    reply.header("X-RateLimit-Remaining", String(remaining));

    if (bucket.count > max) {
      const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
      reply.header("Retry-After", String(retryAfterSec));
      return reply.status(429).send({
        error: "Too many requests. Try again shortly.",
      });
    }
  };
}

// Tight limits on abuse-prone endpoints.
const rateLimitLogin = makeRateLimit("login", 5, 60_000); // 5 / min / IP
const rateLimitRegister = makeRateLimit("register", 3, 60 * 60_000); // 3 / hour / IP
const rateLimitSearch = makeRateLimit("search", 60, 60_000); // 60 / min / IP
const rateLimitVerifyEmail = makeRateLimit("verify-email", 20, 60_000); // 20 / min / IP — generous for legitimate retries
const rateLimitResendVerification = makeRateLimit("resend-verification", 3, 60 * 60_000); // 3 / hour / IP
const rateLimitForgotPassword = makeRateLimit("forgot-password", 3, 60 * 60_000); // 3 / hour / IP
const rateLimitResetPassword = makeRateLimit("reset-password", 10, 60_000); // 10 / min / IP
const rateLimitRequestDelete = makeRateLimit("request-delete", 3, 60 * 60_000); // 3 / hour / IP
const rateLimitConfirmDelete = makeRateLimit("confirm-delete", 10, 60_000); // 10 / min / IP
const rateLimitCreateComment = makeRateLimit("create-comment", 20, 60_000); // 20 / min / IP

// Catch unhandled errors and forward to Sentry (no-op if Sentry not
// initialized). Falls through to Fastify's default error response.
app.setErrorHandler((err, request, reply) => {
  if (process.env.SENTRY_DSN_API) {
    Sentry.captureException(err);
  }
  request.log.error(err);
  reply.send(err);
});

// --- Validation helpers ----------------------------------------------------

function normalizeHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const handle = raw.trim().replace(/^@/, "");
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(handle)) return null;
  // Reserve leading underscore for system handles (e.g. _deleted_*
  // tombstones from anonymized accounts). Existing users without
  // leading underscore are unaffected.
  if (handle.startsWith("_")) return null;
  return handle;
}

function validPassword(raw: unknown): raw is string {
  return typeof raw === "string" && raw.length >= 8 && raw.length <= 128;
}

// Permissive enough to catch typos without rejecting legitimate
// addresses (gmail+tag, country TLDs, etc.). Real deliverability is
// confirmed by the verification email itself.
function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length < 3 || trimmed.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

// Reads the Authorization header and returns the userId if a valid JWT is
// present; returns null otherwise. Use on GET endpoints that should remain
// public but personalize their response (e.g. `liked` per review).
async function getOptionalUserId(
  request: FastifyRequest,
): Promise<string | null> {
  try {
    await request.jwtVerify();
    return request.user.userId;
  } catch {
    return null;
  }
}

// --- Pagination helpers ----------------------------------------------------

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

/** Parse + clamp a `limit` query param. */
function parseLimit(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_PAGE_LIMIT;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.floor(n), MAX_PAGE_LIMIT);
}

/** Parse an ISO-timestamp cursor query param. Returns Date or null. */
function parseCursor(raw: unknown): Date | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * For a list of review ids, fetch the subset that the given viewer has
 * liked. Returns a Set for O(1) lookup. Empty Set when viewerId is null
 * or reviewIds is empty.
 *
 * Used instead of loading `likes: { select: { userId: true } }` per
 * review — that pattern ships every like's userId on every response,
 * which doesn't scale.
 */
async function loadViewerLikedSet(
  viewerId: string | null,
  reviewIds: string[],
): Promise<Set<string>> {
  if (!viewerId || reviewIds.length === 0) return new Set();
  const rows = await prisma.reviewLike.findMany({
    where: { userId: viewerId, reviewId: { in: reviewIds } },
    select: { reviewId: true },
  });
  return new Set(rows.map((r) => r.reviewId));
}

app.get("/health", async () => {
  return { ok: true };
});

// --- Auth ------------------------------------------------------------------

app.post(
  "/auth/register",
  { preHandler: rateLimitRegister },
  async (request, reply) => {
  const body = request.body as {
    handle?: unknown;
    email?: unknown;
    password?: unknown;
  };

  const handle = normalizeHandle(body.handle);
  if (!handle) {
    return reply.status(400).send({
      error: "Handle must be 3-20 chars, letters/numbers/underscore only",
    });
  }
  const email = normalizeEmail(body.email);
  if (!email) {
    return reply.status(400).send({ error: "Valid email is required" });
  }
  if (!validPassword(body.password)) {
    return reply.status(400).send({
      error: "Password must be at least 8 characters",
    });
  }

  const existingHandle = await prisma.user.findUnique({ where: { handle } });
  if (existingHandle) {
    return reply.status(409).send({ error: "Handle already taken" });
  }
  const existingEmail = await prisma.user.findUnique({ where: { email } });
  if (existingEmail) {
    return reply.status(409).send({ error: "Email already in use" });
  }

  const passwordHash = await bcrypt.hash(body.password, 10);

  try {
    const user = await prisma.user.create({
      data: { handle, email, passwordHash },
    });

    // Create verification token and send the email. We deliberately do
    // not block registration on email send failure — the user can hit
    // /auth/resend-verification later. Email service downtime should
    // not prevent signup.
    const now = new Date();
    const verificationToken = await prisma.verificationToken.create({
      data: {
        userId: user.id,
        type: "email_verify",
        token: generateTokenString(),
        expiresAt: tokenExpiresAt("email_verify", now),
      },
    });
    const emailResult = await sendVerificationEmail({
      to: email,
      handle: user.handle,
      token: verificationToken.token,
    });
    if (!emailResult.sent) {
      app.log.warn(
        { reason: emailResult.reason, userId: user.id },
        "verification email did not send",
      );
    }

    const token = await reply.jwtSign(
      { userId: user.id, handle: user.handle },
      { expiresIn: "30d" },
    );

    return reply.status(201).send({
      token,
      user: {
        id: user.id,
        handle: user.handle,
        email: user.email,
        emailVerified: false,
      },
    });
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({
      error: "Failed to register",
      details: err?.message || String(err),
    });
  }
});

app.post(
  "/auth/login",
  { preHandler: rateLimitLogin },
  async (request, reply) => {
  const body = request.body as { handle?: unknown; password?: unknown };

  const handle = normalizeHandle(body.handle);
  if (!handle || typeof body.password !== "string") {
    return reply.status(400).send({ error: "Handle and password required" });
  }

  const user = await prisma.user.findUnique({ where: { handle } });
  if (!user || !user.passwordHash) {
    return reply.status(401).send({ error: "Invalid credentials" });
  }
  if (user.anonymizedAt) {
    // Tombstone — login forever rejected. Same generic error so we
    // do not reveal that this handle once belonged to a real account.
    return reply.status(401).send({ error: "Invalid credentials" });
  }

  const ok = await bcrypt.compare(body.password, user.passwordHash);
  if (!ok) {
    return reply.status(401).send({ error: "Invalid credentials" });
  }

  const token = await reply.jwtSign(
    { userId: user.id, handle: user.handle },
    { expiresIn: "30d" },
  );

  return {
    token,
    user: {
      id: user.id,
      handle: user.handle,
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      pendingDeletion: user.deletedAt !== null,
      deletionScheduledFor: user.deletedAt
        ? deletionScheduledFor(user.deletedAt).toISOString()
        : null,
    },
  };
});

app.get("/auth/me", async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: "Not authenticated" });
  }
  const dbUser = await prisma.user.findUnique({
    where: { id: request.user.userId },
    select: {
      id: true,
      handle: true,
      email: true,
      emailVerifiedAt: true,
      name: true,
      avatarUrl: true,
      deletedAt: true,
      anonymizedAt: true,
    },
  });
  if (!dbUser) {
    return reply.status(401).send({ error: "Not authenticated" });
  }
  if (dbUser.anonymizedAt) {
    // Tombstoned — JWT may still be valid but the identity is gone.
    return reply.status(401).send({ error: "Not authenticated" });
  }
  return {
    user: {
      id: dbUser.id,
      handle: dbUser.handle,
      email: dbUser.email,
      emailVerified: dbUser.emailVerifiedAt !== null,
      name: dbUser.name,
      avatarUrl: dbUser.avatarUrl,
      pendingDeletion: dbUser.deletedAt !== null,
      deletionScheduledFor: dbUser.deletedAt
        ? deletionScheduledFor(dbUser.deletedAt).toISOString()
        : null,
    },
  };
});

// Public — validates the token and marks the user verified. Idempotent:
// repeat clicks on the same link (e.g. opening it twice) return 200 as
// long as the user is already verified.
app.post(
  "/auth/verify-email/:token",
  { preHandler: rateLimitVerifyEmail },
  async (request, reply) => {
    const { token } = request.params as { token?: string };
    if (!token || typeof token !== "string" || token.length === 0) {
      return reply.status(400).send({ error: "Token required" });
    }

    const record = await prisma.verificationToken.findUnique({
      where: { token },
      include: { user: true },
    });

    const validity = checkToken({
      record: record
        ? {
            type: record.type,
            expiresAt: record.expiresAt,
            consumedAt: record.consumedAt,
          }
        : null,
      expectedType: "email_verify",
      now: new Date(),
    });

    if (!validity.ok) {
      // If the token is consumed AND the user is already verified, return
      // 200 — the user double-clicked. Anything else: 400.
      if (
        validity.reason === "consumed" &&
        record?.user.emailVerifiedAt
      ) {
        return {
          verified: true,
          email: record.user.email,
        };
      }
      return reply.status(400).send({
        error: "Invalid or expired verification link",
        reason: validity.reason,
      });
    }

    if (!record) {
      // Defensive: validity.ok already implies record is non-null.
      return reply.status(400).send({ error: "Invalid token" });
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: now },
      }),
      prisma.verificationToken.update({
        where: { id: record.id },
        data: { consumedAt: now },
      }),
    ]);

    return {
      verified: true,
      email: record.user.email,
    };
  },
);

// Authenticated — invalidates prior email_verify tokens for the user,
// issues a new one, sends the email. No-ops gracefully if already
// verified.
app.post(
  "/auth/resend-verification",
  { preHandler: rateLimitResendVerification },
  async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const user = await prisma.user.findUnique({
      where: { id: request.user.userId },
    });
    if (!user) {
      return reply.status(401).send({ error: "Not authenticated" });
    }
    if (!user.email) {
      return reply
        .status(400)
        .send({ error: "No email on account" });
    }
    if (user.emailVerifiedAt) {
      return reply.status(400).send({ error: "Email already verified" });
    }

    const now = new Date();
    // Invalidate prior un-consumed email_verify tokens so the old
    // links stop working.
    await prisma.verificationToken.updateMany({
      where: {
        userId: user.id,
        type: "email_verify",
        consumedAt: null,
      },
      data: { consumedAt: now },
    });

    const verificationToken = await prisma.verificationToken.create({
      data: {
        userId: user.id,
        type: "email_verify",
        token: generateTokenString(),
        expiresAt: tokenExpiresAt("email_verify", now),
      },
    });

    const result = await sendVerificationEmail({
      to: user.email,
      handle: user.handle,
      token: verificationToken.token,
    });

    if (!result.sent) {
      app.log.warn(
        { reason: result.reason, userId: user.id },
        "resend verification did not deliver",
      );
      if (result.reason === "not_configured") {
        return reply
          .status(503)
          .send({ error: "Email is not configured on the server yet" });
      }
      return reply
        .status(502)
        .send({ error: "Failed to send verification email" });
    }

    return { sent: true };
  },
);

// Public — initiates the password-reset flow. ALWAYS returns the same
// 200 + message regardless of whether the email is registered, so
// callers cannot enumerate which addresses belong to real accounts.
const FORGOT_PUBLIC_MESSAGE =
  "If an account exists for that email, we sent a reset link.";

app.post(
  "/auth/forgot-password",
  { preHandler: rateLimitForgotPassword },
  async (request, reply) => {
    const body = request.body as { email?: unknown };
    const email = normalizeEmail(body.email);

    // Anti-enumeration: even an obviously-malformed email returns the
    // same 200 + message so timing / status / body cannot leak.
    if (!email) {
      return reply.status(200).send({ message: FORGOT_PUBLIC_MESSAGE });
    }

    try {
      await forgotPassword(
        { email },
        {
          prisma,
          sendPasswordResetEmail,
          now: () => new Date(),
        },
      );
    } catch (err: any) {
      // Log but still return the public message — anti-enumeration
      // trumps surfacing the error to the caller.
      app.log.warn(
        { err: err?.message, email: "<redacted>" },
        "forgot-password handler threw",
      );
    }

    return reply.status(200).send({ message: FORGOT_PUBLIC_MESSAGE });
  },
);

// Public — consumes the token and sets the new password. The token in
// the URL acts as the auth.
app.post(
  "/auth/reset-password",
  { preHandler: rateLimitResetPassword },
  async (request, reply) => {
    const body = request.body as {
      token?: unknown;
      newPassword?: unknown;
    };
    if (typeof body.token !== "string" || body.token.length === 0) {
      return reply.status(400).send({ error: "Token required" });
    }
    if (typeof body.newPassword !== "string") {
      return reply.status(400).send({ error: "New password required" });
    }

    const result = await resetPassword(
      { token: body.token, newPassword: body.newPassword },
      { prisma, now: () => new Date() },
    );

    if (result.ok) {
      return { ok: true };
    }

    switch (result.reason) {
      case "weak_password":
        return reply.status(400).send({
          error: "Password must be 8-128 characters",
          reason: "weak_password",
        });
      case "invalid_token":
        return reply.status(400).send({
          error: "Invalid or expired reset link",
          reason: "invalid_token",
        });
      case "expired":
        return reply.status(400).send({
          error: "Reset link has expired",
          reason: "expired",
        });
      case "consumed":
        return reply.status(400).send({
          error: "Reset link has already been used",
          reason: "consumed",
        });
    }
  },
);

// Authenticated. Starts the account-deletion flow by sending a
// confirmation email. The actual soft-delete only happens after the
// user clicks the link and POSTs to /auth/confirm-delete/:token.
app.post(
  "/auth/request-delete",
  { preHandler: rateLimitRequestDelete },
  async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: "Not authenticated" });
    }
    const result = await requestAccountDelete(
      { userId: request.user.userId },
      {
        prisma,
        sendAccountDeleteConfirmEmail,
        now: () => new Date(),
      },
    );
    if (!result.ok) {
      switch (result.reason) {
        case "already_pending":
          return reply.status(409).send({
            error: "Account deletion is already pending",
            reason: "already_pending",
          });
        case "anonymized":
          return reply.status(401).send({ error: "Not authenticated" });
        case "no_email":
          return reply.status(400).send({
            error: "No email on account",
            reason: "no_email",
          });
      }
    }
    return { sent: result.emailAttempted };
  },
);

// Public — token in the URL acts as auth. Sets User.deletedAt and
// starts the 30-day grace clock.
app.post(
  "/auth/confirm-delete/:token",
  { preHandler: rateLimitConfirmDelete },
  async (request, reply) => {
    const { token } = request.params as { token?: string };
    if (!token || typeof token !== "string" || token.length === 0) {
      return reply.status(400).send({ error: "Token required" });
    }

    const result = await confirmAccountDelete(
      { token },
      { prisma, now: () => new Date() },
    );

    if (result.ok) {
      return {
        ok: true,
        deletionScheduledFor: result.deletionScheduledFor.toISOString(),
      };
    }

    switch (result.reason) {
      case "invalid_token":
        return reply.status(400).send({
          error: "Invalid or expired confirmation link",
          reason: "invalid_token",
        });
      case "expired":
        return reply.status(400).send({
          error: "Confirmation link has expired",
          reason: "expired",
        });
      case "consumed":
        return reply.status(400).send({
          error: "Confirmation link has already been used",
          reason: "consumed",
        });
      case "anonymized":
        return reply.status(410).send({
          error: "Account has already been deleted",
          reason: "anonymized",
        });
    }
  },
);

// Authenticated. Reverses a pending soft-delete during the grace
// window. Cannot un-tombstone an already-anonymized account.
app.post("/auth/cancel-delete", async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: "Not authenticated" });
  }

  const result = await cancelAccountDelete(
    { userId: request.user.userId },
    { prisma },
  );

  if (result.ok) {
    return { ok: true };
  }

  switch (result.reason) {
    case "no_pending":
      return reply.status(400).send({
        error: "Account is not scheduled for deletion",
        reason: "no_pending",
      });
    case "anonymized":
      return reply.status(401).send({ error: "Not authenticated" });
  }
});

// --- End auth --------------------------------------------------------------

app.get(
  "/artists/search",
  { preHandler: rateLimitSearch },
  async (request, reply) => {
  const { q } = request.query as { q?: string };

  if (!q) {
    return reply.status(400).send({ error: "Missing query param 'q'" });
  }

  try {
    const res = await fetch(
      `https://app.ticketmaster.com/discovery/v2/events.json?keyword=${encodeURIComponent(
        q
      )}&apikey=${process.env.TICKETMASTER_API_KEY}`
    );

    const data = await res.json();

    const items =
      data?._embedded?.events?.map((event: any) => ({
        id: event.id,
        name: event.name,
      })) || [];

    return { items };
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: "Failed to fetch artists" });
  }
});

app.get(
  "/shows/search",
  { preHandler: rateLimitSearch },
  async (request, reply) => {
  const { q } = request.query as { q?: string };

  if (!q) {
    return reply.status(400).send({ error: "Missing query param 'q'" });
  }

  try {
    const res = await fetch(
      `https://app.ticketmaster.com/discovery/v2/events.json?keyword=${encodeURIComponent(
        q
      )}&apikey=${process.env.TICKETMASTER_API_KEY}`
    );

    const data = await res.json();

    const items =
      data?._embedded?.events?.map((event: any) => {
        // Ticketmaster's `event.name` is the EVENT/tour title
        // (e.g. "Olivia Rodrigo: The Unraveled Tour"). The actual
        // performing artist is on the first attraction. Use the
        // attraction name as the canonical artist so reviews from
        // different tours collapse onto one Artist row; fall back
        // to event.name only when no attractions are present
        // (uncommon — e.g. some festivals).
        const attractionName: string | undefined =
          event._embedded?.attractions?.[0]?.name;
        return {
          provider: "ticketmaster",
          providerEventId: event.id,
          artist: attractionName || event.name,
          eventName: event.name,
          venue: event._embedded?.venues?.[0]?.name,
          city: event._embedded?.venues?.[0]?.city?.name,
          localDate: event.dates?.start?.localDate,
          ticketUrl: event.url,
        };
      }) || [];

    return { items };
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: "Failed to fetch shows" });
  }
});

app.post("/shows/confirm", async (request, reply) => {
  const body = request.body as {
    artist: string;
    venue: string;
    city: string;
    localDate: string;
  };

  const { artist, venue, city, localDate } = body;

  if (!artist || !venue || !city || !localDate) {
    return reply.status(400).send({
      error: "artist, venue, city, and localDate are required",
    });
  }

  try {
    const parsedDate = new Date(`${localDate}T00:00:00.000Z`);

    // Race-safe Artist resolution via the unique index on Artist.name.
    // Two concurrent requests for the same artist now collide on the
    // index inside Postgres and only one row is created.
    const artistRecord = await prisma.artist.upsert({
      where: { name: artist },
      update: {},
      create: { name: artist },
    });

    // Race-safe Venue resolution via the unique index on (name, city).
    const venueRecord = await prisma.venue.upsert({
      where: { name_city: { name: venue, city } },
      update: {},
      create: { name: venue, city },
    });

    // Show resolution: the existing @@unique([artistId, venueId,
    // localDate]) prevents duplicate Shows once Artist+Venue are
    // race-safe. We do a findUnique first so the response's `existing`
    // flag stays accurate for happy-path callers; if a concurrent
    // request races us between the findUnique and create, the create
    // throws P2002 and we re-read.
    const existingShow = await prisma.show.findUnique({
      where: {
        artistId_venueId_localDate: {
          artistId: artistRecord.id,
          venueId: venueRecord.id,
          localDate: parsedDate,
        },
      },
    });

    if (existingShow) {
      return { showId: existingShow.id, existing: true };
    }

    try {
      const showRecord = await prisma.show.create({
        data: {
          artistId: artistRecord.id,
          venueId: venueRecord.id,
          startDatetimeUtc: parsedDate,
          localDate: parsedDate,
        },
      });
      return { showId: showRecord.id, existing: false };
    } catch (createErr: any) {
      if (createErr?.code === "P2002") {
        const winner = await prisma.show.findUnique({
          where: {
            artistId_venueId_localDate: {
              artistId: artistRecord.id,
              venueId: venueRecord.id,
              localDate: parsedDate,
            },
          },
        });
        if (winner) {
          return { showId: winner.id, existing: true };
        }
      }
      throw createErr;
    }
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({
      error: "Failed to confirm show",
      details: err?.message || String(err),
    });
  }
});

// Search our canonical Shows table. Browse-only — no external API call.
// The frontend pairs this with /shows/search (Ticketmaster) and merges
// the two sources into a single ranked dropdown client-side. Both
// share rateLimitSearch.
app.get(
  "/shows",
  { preHandler: rateLimitSearch },
  async (request, reply) => {
    const query = request.query as {
      q?: string;
      cursor?: string;
      limit?: string;
    };
    const q = typeof query.q === "string" ? query.q : "";
    const rawLimit = Number(query.limit);
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, MAX_SHOW_SEARCH_LIMIT)
        : DEFAULT_SHOW_SEARCH_LIMIT;
    const cursor = parseCursor(query.cursor);

    const result = await searchShows({ q, limit, cursor }, { prisma });
    return reply.send({
      items: result.items.map((s) => ({
        id: s.id,
        artist: s.artist,
        venue: s.venue,
        localDate: s.localDate,
        reviewCount: s.reviewCount,
        attendanceCount: s.attendanceCount,
      })),
      nextCursor: result.nextCursor,
    });
  },
);

app.post("/reviews", async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: "Not authenticated" });
  }

  const { userId } = request.user;

  const body = request.body as {
    showId?: unknown;
    ratingOverall?: unknown;
    reviewTextRaw?: unknown;
  };

  const showId = typeof body.showId === "string" ? body.showId : "";
  const ratingOverall = body.ratingOverall;
  // reviewTextRaw is optional now: a star-rating-only review is allowed
  // (the feed will render the card without a body section). Empty
  // string is the canonical "no text" value at the DB layer.
  const reviewTextRaw =
    typeof body.reviewTextRaw === "string" ? body.reviewTextRaw.trim() : "";

  if (!showId) {
    return reply.status(400).send({ error: "showId is required" });
  }
  if (
    typeof ratingOverall !== "number" ||
    !Number.isInteger(ratingOverall) ||
    ratingOverall < 1 ||
    ratingOverall > 5
  ) {
    return reply.status(400).send({
      error: "ratingOverall must be an integer 1-5",
    });
  }

  try {
    // Atomic: create the review AND ensure an attendance row exists.
    // A review always implies attendance (enforced by Q1 = block-on-
    // unattend), so we upsert here so the invariant holds even when
    // the user has never explicitly clicked Mark as Attended.
    const review = await prisma.$transaction(async (tx) => {
      const created = await tx.review.create({
        data: {
          userId,
          showId,
          ratingOverall,
          reviewTextRaw,
          moderationStatus: "ALLOWED",
          publishedAt: new Date(),
        },
      });
      await tx.attendance.upsert({
        where: { userId_showId: { userId, showId } },
        create: { userId, showId },
        update: {},
      });
      return created;
    });

    return {
      reviewId: review.id,
      status: "published",
    };
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({
      error: "Failed to create review",
      details: err?.message || String(err),
    });
  }
});

app.patch("/reviews/:id", async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: "Not authenticated" });
  }

  const { userId } = request.user;
  const { id } = request.params as { id: string };
  const body = request.body as {
    ratingOverall?: unknown;
    reviewTextRaw?: unknown;
  };

  const updates: { ratingOverall?: number; reviewTextRaw?: string } = {};

  if (body.ratingOverall !== undefined) {
    if (
      typeof body.ratingOverall !== "number" ||
      !Number.isInteger(body.ratingOverall) ||
      body.ratingOverall < 1 ||
      body.ratingOverall > 5
    ) {
      return reply
        .status(400)
        .send({ error: "ratingOverall must be an integer 1-5" });
    }
    updates.ratingOverall = body.ratingOverall;
  }

  if (body.reviewTextRaw !== undefined) {
    if (typeof body.reviewTextRaw !== "string") {
      return reply
        .status(400)
        .send({ error: "reviewTextRaw must be a string" });
    }
    // Empty text is allowed — a rating-only review is valid.
    updates.reviewTextRaw = body.reviewTextRaw.trim();
  }

  if (Object.keys(updates).length === 0) {
    return reply.status(400).send({ error: "Nothing to update" });
  }

  const existing = await prisma.review.findUnique({ where: { id } });
  if (!existing) {
    return reply.status(404).send({ error: "Review not found" });
  }
  if (existing.userId !== userId) {
    return reply.status(403).send({ error: "Not authorized" });
  }

  try {
    const updated = await prisma.review.update({
      where: { id },
      data: updates,
    });
    return {
      id: updated.id,
      ratingOverall: updated.ratingOverall,
      reviewTextRaw: updated.reviewTextRaw,
    };
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({
      error: "Failed to update review",
      details: err?.message || String(err),
    });
  }
});

app.delete("/reviews/:id", async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: "Not authenticated" });
  }

  const { userId } = request.user;
  const { id } = request.params as { id: string };

  const existing = await prisma.review.findUnique({ where: { id } });
  if (!existing) {
    return reply.status(404).send({ error: "Review not found" });
  }
  if (existing.userId !== userId) {
    return reply.status(403).send({ error: "Not authorized" });
  }

  try {
    await prisma.review.delete({ where: { id } });
    return reply.status(204).send();
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({
      error: "Failed to delete review",
      details: err?.message || String(err),
    });
  }
});

app.post("/reviews/:id/like", async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: "Not authenticated" });
  }

  const { userId } = request.user;
  const { id: reviewId } = request.params as { id: string };

  // Confirm the review exists (so we can't like a phantom).
  const review = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!review) {
    return reply.status(404).send({ error: "Review not found" });
  }

  try {
    // Idempotent: composite unique on (userId, reviewId) means we can
    // safely upsert. If already liked, this is a no-op.
    await prisma.reviewLike.upsert({
      where: { userId_reviewId: { userId, reviewId } },
      create: { userId, reviewId },
      update: {},
    });

    const likeCount = await prisma.reviewLike.count({ where: { reviewId } });
    return { liked: true, likeCount };
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({
      error: "Failed to like review",
      details: err?.message || String(err),
    });
  }
});

app.delete("/reviews/:id/like", async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: "Not authenticated" });
  }

  const { userId } = request.user;
  const { id: reviewId } = request.params as { id: string };

  try {
    // Idempotent: if no row exists, deleteMany returns count 0 — fine.
    await prisma.reviewLike.deleteMany({ where: { userId, reviewId } });
    const likeCount = await prisma.reviewLike.count({ where: { reviewId } });
    return { liked: false, likeCount };
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({
      error: "Failed to unlike review",
      details: err?.message || String(err),
    });
  }
});

// --- Review comments -------------------------------------------------------

app.get("/reviews/:reviewId/comments", async (request, reply) => {
  const { reviewId } = request.params as { reviewId: string };
  const query = request.query as { cursor?: string; limit?: string };
  const rawLimit = Number(query.limit);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_COMMENTS_LIMIT)
      : DEFAULT_COMMENTS_LIMIT;
  const cursor = parseCursor(query.cursor);

  const result = await listComments(
    { reviewId, limit, cursor },
    { prisma },
  );
  if (!result.ok) {
    return reply.status(404).send({ error: "Review not found" });
  }
  return {
    items: result.items.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      userHandle: c.userHandle,
      userName: c.userName,
      userAvatarUrl: c.userAvatarUrl,
    })),
    nextCursor: result.nextCursor,
  };
});

app.post(
  "/reviews/:reviewId/comments",
  { preHandler: rateLimitCreateComment },
  async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: "Not authenticated" });
    }
    const { reviewId } = request.params as { reviewId: string };
    const body = request.body as { body?: unknown };
    const result = await createComment(
      {
        reviewId,
        userId: request.user.userId,
        body: typeof body.body === "string" ? body.body : "",
      },
      { prisma },
    );
    if (!result.ok) {
      switch (result.reason) {
        case "review_not_found":
          return reply.status(404).send({ error: "Review not found" });
        case "body_too_short":
          return reply
            .status(400)
            .send({ error: "Comment cannot be empty", reason: "body_too_short" });
        case "body_too_long":
          return reply.status(400).send({
            error: "Comment must be 2000 characters or fewer",
            reason: "body_too_long",
          });
      }
    }
    return reply.status(201).send({ comment: result.comment });
  },
);

app.delete(
  "/reviews/:reviewId/comments/:commentId",
  async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: "Not authenticated" });
    }
    const { reviewId, commentId } = request.params as {
      reviewId: string;
      commentId: string;
    };
    const result = await deleteComment(
      { commentId, reviewId, userId: request.user.userId },
      { prisma },
    );
    if (!result.ok) {
      return reply.status(404).send({ error: "Comment not found" });
    }
    return reply.status(204).send();
  },
);

app.get("/feed", async (request, reply) => {
  const viewerId = await getOptionalUserId(request);
  const query = request.query as {
    scope?: string;
    cursor?: string;
    limit?: string;
  };
  const followingScope = query.scope === "following";
  const limit = parseLimit(query.limit);
  const cursor = parseCursor(query.cursor);

  // /feed?scope=following without a signed-in viewer = empty by design;
  // the frontend renders a sign-in prompt instead of an error.
  if (followingScope && !viewerId) {
    return { items: [], nextCursor: null };
  }

  try {
    // For the following scope, pre-resolve the set of userIds the viewer
    // follows.
    let followingIds: string[] | null = null;
    if (followingScope && viewerId) {
      const follows = await prisma.follow.findMany({
        where: { followerId: viewerId },
        select: { followingId: true },
      });
      followingIds = follows.map((f) => f.followingId);
      if (followingIds.length === 0) {
        return { items: [], nextCursor: null };
      }
    }

    // Fetch limit+1 so we know whether there's another page.
    const reviewWhere = {
      ...(followingIds ? { userId: { in: followingIds } } : {}),
      ...(cursor ? { publishedAt: { lt: cursor } } : {}),
    };

    const reviews = await prisma.review.findMany({
      where: reviewWhere,
      orderBy: { publishedAt: "desc" },
      take: limit + 1,
      include: {
        user: true,
        show: {
          include: {
            artist: true,
            venue: true,
          },
        },
        _count: {
          select: {
            likes: true,
            comments: { where: { moderationStatus: { not: "BLOCKED" } } },
          },
        },
      },
    });

    // Batched per-viewer liked lookup — one small query instead of
    // shipping all userIds per review.
    const reviewIds = reviews.map((r) => r.id);
    const likedSet = await loadViewerLikedSet(viewerId, reviewIds);

    const reviewItems = reviews.map((review) => ({
      type: "review" as const,
      reviewId: review.id,
      userHandle: review.user.handle,
      userName: review.user.name,
      userAvatarUrl: review.user.avatarUrl,
      ratingOverall: review.ratingOverall,
      reviewTextRaw: review.reviewTextRaw,
      publishedAt: review.publishedAt,
      likeCount: review._count.likes,
      commentCount: review._count.comments,
      liked: likedSet.has(review.id),
      show: {
        id: review.show.id,
        localDate: review.show.localDate,
        artistId: review.show.artist.id,
        artist: review.show.artist.name,
        venue: review.show.venue.name,
        city: review.show.venue.city,
      },
    }));

    // All-tab semantics: reviews only.
    if (!followingScope) {
      const hasMore = reviewItems.length > limit;
      const page = hasMore ? reviewItems.slice(0, limit) : reviewItems;
      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last?.publishedAt
          ? new Date(last.publishedAt).toISOString()
          : null;
      return { items: page, nextCursor };
    }

    // Following-tab semantics: reviews PLUS attendance-only activity
    // from followed users. Dedupe — if the same (userId, showId) pair
    // has both a review AND an attendance, only the review appears.
    const reviewedPairs = new Set(
      reviews.map((r) => `${r.userId}|${r.showId}`),
    );

    const attendances = await prisma.attendance.findMany({
      where: {
        userId: { in: followingIds ?? [] },
        ...(cursor ? { attendedAt: { lt: cursor } } : {}),
      },
      orderBy: { attendedAt: "desc" },
      take: limit + 1,
      include: {
        user: true,
        show: {
          include: {
            artist: true,
            venue: true,
          },
        },
      },
    });

    const attendanceItems = attendances
      .filter((a) => !reviewedPairs.has(`${a.userId}|${a.showId}`))
      .map((a) => ({
        type: "attendance" as const,
        attendanceId: a.id,
        userHandle: a.user.handle,
        userName: a.user.name,
        userAvatarUrl: a.user.avatarUrl,
        attendedAt: a.attendedAt,
        show: {
          id: a.show.id,
          localDate: a.show.localDate,
          artistId: a.show.artist.id,
          artist: a.show.artist.name,
          venue: a.show.venue.name,
          city: a.show.venue.city,
        },
      }));

    const ts = (item: (typeof reviewItems)[number] | (typeof attendanceItems)[number]) =>
      item.type === "review"
        ? item.publishedAt
          ? new Date(item.publishedAt).getTime()
          : 0
        : new Date(item.attendedAt).getTime();

    const merged = [...reviewItems, ...attendanceItems].sort(
      (a, b) => ts(b) - ts(a),
    );
    const hasMore = merged.length > limit;
    const page = hasMore ? merged.slice(0, limit) : merged;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? new Date(ts(last)).toISOString() : null;

    return { items: page, nextCursor };
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({
      error: "Failed to fetch feed",
      details: err?.message || String(err),
    });
  }
});

app.get("/artists/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const viewerId = await getOptionalUserId(request);
  const query = request.query as { cursor?: string; limit?: string };
  const limit = parseLimit(query.limit);
  const cursor = parseCursor(query.cursor);

  try {
    const artist = await prisma.artist.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!artist) {
      return reply.status(404).send({ error: "Artist not found" });
    }

    // Reviews live on shows; we filter by show.artistId. Aggregate
    // count + average across all of them (not just the page).
    const reviewStats = await prisma.review.aggregate({
      where: { show: { artistId: id } },
      _count: true,
      _avg: { ratingOverall: true },
    });

    // Paginated reviews page.
    const reviews = await prisma.review.findMany({
      where: {
        show: { artistId: id },
        ...(cursor ? { publishedAt: { lt: cursor } } : {}),
      },
      orderBy: { publishedAt: "desc" },
      take: limit + 1,
      include: {
        user: true,
        show: {
          select: {
            id: true,
            localDate: true,
            venue: { select: { name: true, city: true } },
          },
        },
        _count: {
          select: {
            likes: true,
            comments: { where: { moderationStatus: { not: "BLOCKED" } } },
          },
        },
      },
    });

    const reviewIds = reviews.map((r) => r.id);
    const likedSet = await loadViewerLikedSet(viewerId, reviewIds);

    const reviewsHasMore = reviews.length > limit;
    const reviewsPage = reviewsHasMore ? reviews.slice(0, limit) : reviews;
    const reviewsLast = reviewsPage[reviewsPage.length - 1];
    const reviewsNextCursor =
      reviewsHasMore && reviewsLast?.publishedAt
        ? new Date(reviewsLast.publishedAt).toISOString()
        : null;

    return {
      id: artist.id,
      name: artist.name,
      averageRating: Number((reviewStats._avg.ratingOverall ?? 0).toFixed(1)),
      reviewCount: reviewStats._count,
      reviews: reviewsPage.map((review) => ({
        id: review.id,
        userHandle: review.user.handle,
        userName: review.user.name,
        userAvatarUrl: review.user.avatarUrl,
        ratingOverall: review.ratingOverall,
        reviewTextRaw: review.reviewTextRaw,
        likeCount: review._count.likes,
        commentCount: review._count.comments,
        liked: likedSet.has(review.id),
        show: {
          id: review.show.id,
          localDate: review.show.localDate,
          venue: review.show.venue,
        },
      })),
      reviewsNextCursor,
    };
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({
      error: "Failed to fetch artist",
      details: err?.message || String(err),
    });
  }
});

app.post("/shows/:id/attend", async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: "Not authenticated" });
  }

  const { userId } = request.user;
  const { id: showId } = request.params as { id: string };

  const show = await prisma.show.findUnique({ where: { id: showId } });
  if (!show) {
    return reply.status(404).send({ error: "Show not found" });
  }

  try {
    // Idempotent: (userId, showId) is unique.
    await prisma.attendance.upsert({
      where: { userId_showId: { userId, showId } },
      create: { userId, showId },
      update: {},
    });
    const attendanceCount = await prisma.attendance.count({
      where: { showId },
    });
    return { attended: true, attendanceCount };
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({
      error: "Failed to mark attendance",
      details: err?.message || String(err),
    });
  }
});

app.delete("/shows/:id/attend", async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: "Not authenticated" });
  }

  const { userId } = request.user;
  const { id: showId } = request.params as { id: string };

  // Invariant: a review always implies attendance. Refuse to unattend
  // if the user has a review for this show; they have to delete the
  // review first.
  const existingReview = await prisma.review.findFirst({
    where: { userId, showId },
    select: { id: true },
  });
  if (existingReview) {
    return reply.status(409).send({
      error: "Can't unattend a show you've reviewed. Delete the review first.",
    });
  }

  try {
    await prisma.attendance.deleteMany({ where: { userId, showId } });
    const attendanceCount = await prisma.attendance.count({
      where: { showId },
    });
    return { attended: false, attendanceCount };
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({
      error: "Failed to unmark attendance",
      details: err?.message || String(err),
    });
  }
});

app.get("/shows/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const viewerId = await getOptionalUserId(request);
  const query = request.query as { cursor?: string; limit?: string };
  const limit = parseLimit(query.limit);
  const cursor = parseCursor(query.cursor);

  try {
    // Show + counts (aggregate queries so we don't load every review and
    // attendance row to compute totals).
    const [show, reviewStats, attendanceCount, viewerAttendance] =
      await Promise.all([
        prisma.show.findUnique({
          where: { id },
          include: { artist: true, venue: true },
        }),
        prisma.review.aggregate({
          where: { showId: id },
          _count: true,
          _avg: { ratingOverall: true },
        }),
        prisma.attendance.count({ where: { showId: id } }),
        viewerId
          ? prisma.attendance.findUnique({
              where: { userId_showId: { userId: viewerId, showId: id } },
              select: { id: true },
            })
          : Promise.resolve(null),
      ]);

    if (!show) {
      return reply.status(404).send({ error: "Show not found" });
    }

    // Paginated reviews page (cursor + limit+1).
    const reviews = await prisma.review.findMany({
      where: {
        showId: id,
        ...(cursor ? { publishedAt: { lt: cursor } } : {}),
      },
      orderBy: { publishedAt: "desc" },
      take: limit + 1,
      include: {
        user: true,
        _count: {
          select: {
            likes: true,
            comments: { where: { moderationStatus: { not: "BLOCKED" } } },
          },
        },
      },
    });

    const reviewIds = reviews.map((r) => r.id);
    const likedSet = await loadViewerLikedSet(viewerId, reviewIds);

    const reviewsHasMore = reviews.length > limit;
    const reviewsPage = reviewsHasMore ? reviews.slice(0, limit) : reviews;
    const reviewsLast = reviewsPage[reviewsPage.length - 1];
    const reviewsNextCursor =
      reviewsHasMore && reviewsLast?.publishedAt
        ? new Date(reviewsLast.publishedAt).toISOString()
        : null;

    return {
      id: show.id,
      localDate: show.localDate,
      artist: { id: show.artist.id, name: show.artist.name },
      venue: { name: show.venue.name, city: show.venue.city },
      averageRating: Number((reviewStats._avg.ratingOverall ?? 0).toFixed(1)),
      reviewCount: reviewStats._count,
      attendanceCount,
      attendedByMe: !!viewerAttendance,
      reviews: reviewsPage.map((review) => ({
        id: review.id,
        userHandle: review.user.handle,
        userName: review.user.name,
        userAvatarUrl: review.user.avatarUrl,
        ratingOverall: review.ratingOverall,
        reviewTextRaw: review.reviewTextRaw,
        publishedAt: review.publishedAt,
        likeCount: review._count.likes,
        commentCount: review._count.comments,
        liked: likedSet.has(review.id),
      })),
      reviewsNextCursor,
    };
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({
      error: "Failed to fetch show",
      details: err?.message || String(err),
    });
  }
});

app.get("/users/:handle", async (request, reply) => {
  const { handle } = request.params as { handle: string };
  const viewerId = await getOptionalUserId(request);
  const query = request.query as { cursor?: string; limit?: string };
  const limit = parseLimit(query.limit);
  const cursor = parseCursor(query.cursor);

  try {
    const user = await prisma.user.findUnique({
      where: { handle },
      select: {
        id: true,
        handle: true,
        name: true,
        avatarUrl: true,
        createdAt: true,
        anonymizedAt: true,
      },
    });

    if (!user || user.anonymizedAt) {
      // 404 for anonymized users: the handle is now _deleted_<suffix>,
      // and the public-facing identity is gone. Reviews still attribute
      // to this row in show/feed responses; the frontend renders those
      // as "[deleted user]" without a link to a profile page.
      return reply.status(404).send({ error: "User not found" });
    }

    // Attendance-derived stats: we need distinct artist + venue counts,
    // so we must load (artistId, venueId) for every attendance — but
    // just those two integers per row, no relations. For 1k users with
    // <1000 attendances each this is fine; beyond that, denormalize
    // these as columns on User and increment/decrement in the
    // attend/unattend transactions.
    const attendanceShows = await prisma.attendance.findMany({
      where: { userId: user.id },
      select: { show: { select: { artistId: true, venueId: true } } },
    });
    const attendedShowCount = attendanceShows.length;
    const artistsSeenCount = new Set(
      attendanceShows.map((a) => a.show.artistId),
    ).size;
    const venuesVisitedCount = new Set(
      attendanceShows.map((a) => a.show.venueId),
    ).size;

    // Review aggregates + follow counts in parallel.
    const [reviewStats, followerCount, followingCount, viewerFollow] =
      await Promise.all([
        prisma.review.aggregate({
          where: { userId: user.id },
          _count: true,
          _avg: { ratingOverall: true },
        }),
        prisma.follow.count({ where: { followingId: user.id } }),
        prisma.follow.count({ where: { followerId: user.id } }),
        viewerId && viewerId !== user.id
          ? prisma.follow.findUnique({
              where: {
                followerId_followingId: {
                  followerId: viewerId,
                  followingId: user.id,
                },
              },
            })
          : Promise.resolve(null),
      ]);

    // Paginated reviews page.
    const reviews = await prisma.review.findMany({
      where: {
        userId: user.id,
        ...(cursor ? { publishedAt: { lt: cursor } } : {}),
      },
      orderBy: { publishedAt: "desc" },
      take: limit + 1,
      include: {
        show: {
          include: { artist: true, venue: true },
        },
        _count: {
          select: {
            likes: true,
            comments: { where: { moderationStatus: { not: "BLOCKED" } } },
          },
        },
      },
    });

    const reviewIds = reviews.map((r) => r.id);
    const likedSet = await loadViewerLikedSet(viewerId, reviewIds);

    const reviewsHasMore = reviews.length > limit;
    const reviewsPage = reviewsHasMore ? reviews.slice(0, limit) : reviews;
    const reviewsLast = reviewsPage[reviewsPage.length - 1];
    const reviewsNextCursor =
      reviewsHasMore && reviewsLast?.publishedAt
        ? new Date(reviewsLast.publishedAt).toISOString()
        : null;

    return {
      handle: user.handle,
      name: user.name,
      avatarUrl: user.avatarUrl,
      joinedAt: user.createdAt,
      attendedShowCount,
      artistsSeenCount,
      venuesVisitedCount,
      reviewCount: reviewStats._count,
      averageRating: Number((reviewStats._avg.ratingOverall ?? 0).toFixed(1)),
      followerCount,
      followingCount,
      followedByMe: !!viewerFollow,
      reviews: reviewsPage.map((review) => ({
        id: review.id,
        ratingOverall: review.ratingOverall,
        reviewTextRaw: review.reviewTextRaw,
        publishedAt: review.publishedAt,
        likeCount: review._count.likes,
        commentCount: review._count.comments,
        liked: likedSet.has(review.id),
        show: {
          id: review.show.id,
          localDate: review.show.localDate,
          artist: {
            id: review.show.artist.id,
            name: review.show.artist.name,
          },
          venue: {
            name: review.show.venue.name,
            city: review.show.venue.city,
          },
        },
      })),
      reviewsNextCursor,
    };
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({
      error: "Failed to fetch user",
      details: err?.message || String(err),
    });
  }
});

app.patch("/users/me", async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: "Not authenticated" });
  }

  const { userId } = request.user;
  const body = request.body as { name?: unknown; avatarUrl?: unknown };

  const updates: { name?: string | null; avatarUrl?: string | null } = {};

  if (body.name !== undefined) {
    if (body.name === null || body.name === "") {
      updates.name = null;
    } else if (typeof body.name !== "string") {
      return reply.status(400).send({ error: "name must be a string" });
    } else {
      const trimmed = body.name.trim();
      if (trimmed.length === 0) {
        updates.name = null;
      } else if (trimmed.length > 50) {
        return reply
          .status(400)
          .send({ error: "name must be at most 50 characters" });
      } else {
        updates.name = trimmed;
      }
    }
  }

  if (body.avatarUrl !== undefined) {
    if (body.avatarUrl === null || body.avatarUrl === "") {
      updates.avatarUrl = null;
    } else if (typeof body.avatarUrl !== "string") {
      return reply.status(400).send({ error: "avatarUrl must be a string" });
    } else {
      const trimmed = body.avatarUrl.trim();
      if (trimmed.length === 0) {
        updates.avatarUrl = null;
      } else if (trimmed.length > 500) {
        return reply
          .status(400)
          .send({ error: "avatarUrl must be at most 500 characters" });
      } else {
        // Sanity check: must parse as a URL with http(s) scheme.
        let parsed: URL;
        try {
          parsed = new URL(trimmed);
        } catch {
          return reply
            .status(400)
            .send({ error: "avatarUrl must be a valid URL" });
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return reply
            .status(400)
            .send({ error: "avatarUrl must be an http(s) URL" });
        }
        updates.avatarUrl = trimmed;
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return reply.status(400).send({ error: "Nothing to update" });
  }

  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: updates,
    });
    return {
      handle: updated.handle,
      name: updated.name,
      avatarUrl: updated.avatarUrl,
    };
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({
      error: "Failed to update profile",
      details: err?.message || String(err),
    });
  }
});

app.post("/users/:handle/follow", async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: "Not authenticated" });
  }

  const { userId: followerId } = request.user;
  const { handle } = request.params as { handle: string };

  const target = await prisma.user.findUnique({ where: { handle } });
  if (!target) {
    return reply.status(404).send({ error: "User not found" });
  }
  if (target.id === followerId) {
    return reply.status(400).send({ error: "You can't follow yourself" });
  }

  try {
    await prisma.follow.upsert({
      where: {
        followerId_followingId: { followerId, followingId: target.id },
      },
      create: { followerId, followingId: target.id },
      update: {},
    });
    const followerCount = await prisma.follow.count({
      where: { followingId: target.id },
    });
    return { following: true, followerCount };
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({
      error: "Failed to follow",
      details: err?.message || String(err),
    });
  }
});

app.delete("/users/:handle/follow", async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: "Not authenticated" });
  }

  const { userId: followerId } = request.user;
  const { handle } = request.params as { handle: string };

  const target = await prisma.user.findUnique({ where: { handle } });
  if (!target) {
    return reply.status(404).send({ error: "User not found" });
  }

  try {
    await prisma.follow.deleteMany({
      where: { followerId, followingId: target.id },
    });
    const followerCount = await prisma.follow.count({
      where: { followingId: target.id },
    });
    return { following: false, followerCount };
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({
      error: "Failed to unfollow",
      details: err?.message || String(err),
    });
  }
});

registerInternalRoutes(app, prisma);

const start = async () => {
  try {
    await app.listen({ port: 3001, host: "0.0.0.0" });
    console.log("Server running on http://localhost:3001");
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();