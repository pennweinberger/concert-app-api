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
  createNotification,
  listNotifications,
  NotificationType,
  DEFAULT_NOTIFICATIONS_LIMIT,
  MAX_NOTIFICATIONS_LIMIT,
} from "./lib/notifications.js";
import { NOT_BLOCKED, NOT_BLOCKED_COUNT } from "./lib/moderation.js";
import {
  createReport,
  listOpenReportsGrouped,
  blockContent,
  restoreContent,
  dismissReport,
  dismissTarget,
  suspendUser,
  unsuspendUser,
} from "./lib/reports.js";
import {
  searchShows,
  DEFAULT_SHOW_SEARCH_LIMIT,
  MAX_SHOW_SEARCH_LIMIT,
} from "./lib/showSearch.js";
import {
  resolveArtist,
  resolveVenue,
} from "./lib/showResolution.js";
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
// /shows/confirm creates Artist / Venue / Show rows from caller-supplied
// text. Generous enough for a real person adding a few shows they
// attended, tight enough that it isn't a bulk row-creation vector.
const rateLimitConfirmShow = makeRateLimit("confirm-show", 20, 60 * 60_000); // 20 / hour / IP
const rateLimitCreateComment = makeRateLimit("create-comment", 20, 60_000); // 20 / min / IP

// Catch unhandled errors and forward to Sentry (no-op if Sentry not
// initialized). Falls through to Fastify's default error response.
//
// Only 5xx (genuine server faults) go to Sentry. 4xx errors — malformed
// JSON bodies, schema validation, rate-limit rejections — are client
// mistakes, not bugs, and would otherwise flood Sentry with noise any
// time a bot or a fat-fingered request hits the API. Errors thrown
// without a statusCode default to 500 (a real unhandled fault) and are
// still reported.
app.setErrorHandler((err, request, reply) => {
  const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
  if (process.env.SENTRY_DSN_API && statusCode >= 500) {
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

// Requires a valid JWT AND a verified email. On failure it sends the
// response (401 not-authenticated / 403 email-not-verified) and returns
// null — callers must `if (!userId) return;`. Gates content-producing
// actions (review, comment, like, follow) so unverified accounts — the
// cheap bot/spam vector — can't post. We check emailVerifiedAt against
// the DB rather than trusting the JWT, because tokens are long-lived
// (30d) and a user who verifies mid-token must not stay locked out.
// Requires a valid JWT and a NON-SUSPENDED account — but NOT a verified
// email. This is the gate for member actions that unverified users are
// allowed to take: like, follow, file report, and edit an existing
// review. Removals (unlike, unfollow, delete own content) intentionally
// skip this so a suspended user can still clean up after themselves.
async function requireActiveUserId(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string | null> {
  try {
    await request.jwtVerify();
  } catch {
    reply.status(401).send({ error: "Not authenticated" });
    return null;
  }
  const { userId } = request.user;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { suspendedAt: true },
  });
  if (!user) {
    reply.status(401).send({ error: "Not authenticated" });
    return null;
  }
  if (user.suspendedAt) {
    reply.status(403).send({
      error: "Your account is suspended.",
      reason: "account_suspended",
    });
    return null;
  }
  return userId;
}

// Requires an active (non-suspended) user who has ALSO verified their
// email. Gates ONLY content PUBLICATION — create review, create comment.
// Everything else (browse, search, follow, like, notifications) stays
// open to unverified users to maximize activation; verification is the
// anti-spam gate on posting only. Checked against the DB (not the JWT),
// so a user who verifies mid-session is unblocked on their next attempt
// without re-logging-in. Suspension is checked first (via
// requireActiveUserId), so a suspended user gets account_suspended
// rather than the verify-your-email flow.
async function requireVerifiedActiveUserId(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string | null> {
  const userId = await requireActiveUserId(request, reply);
  if (!userId) return null; // 401 / 403 account_suspended already sent
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailVerifiedAt: true },
  });
  if (!user?.emailVerifiedAt) {
    reply.status(403).send({
      error: "Verify your email to publish reviews and comments.",
      reason: "email_not_verified",
    });
    return null;
  }
  return userId;
}

// Requires a valid JWT AND an admin account. Guards all /admin/* routes.
async function requireAdminUserId(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string | null> {
  try {
    await request.jwtVerify();
  } catch {
    reply.status(401).send({ error: "Not authenticated" });
    return null;
  }
  const { userId } = request.user;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  });
  if (!user?.isAdmin) {
    reply.status(403).send({ error: "Forbidden" });
    return null;
  }
  return userId;
}

// --- Pagination helpers ----------------------------------------------------

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

/**
 * Composite history cursor: "<showLocalDateISO>|<showId>". Needed because
 * the profile history merges reviews and attendances into one stream
 * ordered by (show.localDate desc, show.id desc) — a bare timestamp can't
 * disambiguate shows sharing a date.
 */
function parseHistoryCursor(
  raw: unknown,
): { localDate: Date; showId: string } | null {
  if (typeof raw !== "string" || !raw.includes("|")) return null;
  const idx = raw.indexOf("|");
  const datePart = raw.slice(0, idx);
  const showId = raw.slice(idx + 1);
  if (!showId) return null;
  const localDate = new Date(datePart);
  if (Number.isNaN(localDate.getTime())) return null;
  return { localDate, showId };
}

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
        isAdmin: user.isAdmin,
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
      isAdmin: user.isAdmin,
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
      isAdmin: true,
      suspendedAt: true,
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
      isAdmin: dbUser.isAdmin,
      suspended: dbUser.suspendedAt !== null,
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
    // `sort` matters more than `size`, and it is free.
    //
    // Ticketmaster defaults to relevance ordering with a 20-item page.
    // Relevance ordering was actively wrong for us: "madison square
    // garden" returned 20 of 181 events ALL dated about five months out,
    // so that venue's shows for the current week were invisible —
    // exactly the "only shows future concerts" complaint. Sorting by
    // date ascending returns the soonest shows instead, reordering the
    // same page at no extra cost. Measured: "brooklyn" went from 4 NYC
    // results scattered across months to 14 starting yesterday.
    //
    // The larger page then fixes genuine truncation — "hilary duff" has
    // 30 events and we were silently taking 20. 50 holds the response
    // near 500KB; 100 nearly doubles it, which is not worth it for a
    // debounced type-ahead. Because results are date-ordered, whatever
    // falls past the cut is the furthest-future, i.e. the least likely
    // to be reviewed.
    const res = await fetch(
      `https://app.ticketmaster.com/discovery/v2/events.json?keyword=${encodeURIComponent(
        q
      )}&size=50&sort=date,asc&apikey=${process.env.TICKETMASTER_API_KEY}`
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
        const attraction = event._embedded?.attractions?.[0];
        const tmVenue = event._embedded?.venues?.[0];
        return {
          provider: "ticketmaster",
          providerEventId: event.id,
          artist: attraction?.name || event.name,
          // Stable Ticketmaster ids — surfaced so /shows/confirm can
          // resolve Artist + Venue rows by id, collapsing variant
          // name spellings ("Ocean Resort Casino" vs "Ocean Casino
          // Resort") onto one canonical row.
          artistTicketmasterId: attraction?.id ?? null,
          eventName: event.name,
          venue: tmVenue?.name,
          venueTicketmasterId: tmVenue?.id ?? null,
          city: tmVenue?.city?.name,
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

// Promotes a show into our canonical tables — either from a Ticketmaster
// search result or from a user typing in a show we never ingested (the
// only route to reviewing a gig at a venue outside the ingest allowlist,
// since Ticketmaster drops events once they've happened).
//
// Requires an active account. It writes Artist / Venue / Show rows from
// caller-supplied text, so leaving it open would be a free row-creation
// endpoint. Both callers already gate on sign-in client-side; this makes
// it true server-side as well.
app.post(
  "/shows/confirm",
  { preHandler: rateLimitConfirmShow },
  async (request, reply) => {
  const userId = await requireActiveUserId(request, reply);
  if (!userId) return;

  const body = request.body as {
    artist?: unknown;
    venue?: unknown;
    city?: unknown;
    localDate?: unknown;
    artistTicketmasterId?: string | null;
    venueTicketmasterId?: string | null;
  };

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const artist = str(body.artist);
  const venue = str(body.venue);
  const city = str(body.city);
  const localDate = str(body.localDate);

  if (!artist || !venue || !city || !localDate) {
    return reply.status(400).send({
      error: "artist, venue, city, and localDate are required",
    });
  }

  // Free-text fields land in unique indexes and render as headlines, so
  // bound them rather than trusting the client.
  if (artist.length > 200 || venue.length > 200 || city.length > 120) {
    return reply.status(400).send({ error: "Field too long" });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    return reply
      .status(400)
      .send({ error: "localDate must be YYYY-MM-DD" });
  }

  try {
    const parsedDate = new Date(`${localDate}T00:00:00.000Z`);
    if (Number.isNaN(parsedDate.getTime())) {
      return reply.status(400).send({ error: "localDate is not a real date" });
    }

    // Resolve Artist + Venue via the showResolution lib. When the
    // caller passes a Ticketmaster id, those are the primary lookup
    // keys — collapsing variant name spellings onto canonical rows.
    // When they're absent, the lib falls back to race-safe name(+city)
    // upserts via the unique indexes.
    const artistRecord = await resolveArtist(
      { name: artist, ticketmasterId: body.artistTicketmasterId ?? null },
      { prisma },
    );
    const venueRecord = await resolveVenue(
      {
        name: venue,
        city,
        ticketmasterId: body.venueTicketmasterId ?? null,
      },
      { prisma },
    );

    // Show resolution: findUnique first so the `existing` flag stays
    // accurate for happy-path callers; on a concurrent-create race,
    // the second create throws P2002 and we re-read the winner.
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
},
);

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
      limit?: string;
    };
    const q = typeof query.q === "string" ? query.q : "";
    const rawLimit = Number(query.limit);
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, MAX_SHOW_SEARCH_LIMIT)
        : DEFAULT_SHOW_SEARCH_LIMIT;

    // No cursor: results are ordered by distance from today in both
    // directions, which a localDate cursor cannot express. This is a
    // type-ahead capped at MAX_SHOW_SEARCH_LIMIT and no caller ever
    // paginated it, so the field is gone rather than left meaning
    // something subtly different.
    const result = await searchShows({ q, limit }, { prisma });
    return reply.send({
      items: result.items.map((s) => ({
        id: s.id,
        artist: s.artist,
        venue: s.venue,
        localDate: s.localDate,
        reviewCount: s.reviewCount,
        attendanceCount: s.attendanceCount,
      })),
    });
  },
);

app.post("/reviews", async (request, reply) => {
  const userId = await requireVerifiedActiveUserId(request, reply);
  if (!userId) return;

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
  const userId = await requireActiveUserId(request, reply);
  if (!userId) return;
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
  const userId = await requireActiveUserId(request, reply);
  if (!userId) return;
  const { id: reviewId } = request.params as { id: string };

  // Confirm the review exists (so we can't like a phantom). We need
  // the author (userId) to notify them of a new like.
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { id: true, userId: true, showId: true, moderationStatus: true },
  });
  // Treat a blocked review as not-found — you can't interact with hidden
  // content, and we don't reveal its existence.
  if (!review || review.moderationStatus === "BLOCKED") {
    return reply.status(404).send({ error: "Review not found" });
  }

  try {
    // Idempotent via the (userId, reviewId) unique constraint, but we
    // need to know whether THIS call created a new like (vs. a repeat)
    // so we only notify once. create-or-catch-P2002 gives that
    // definitively and race-safely; an upsert would hide it.
    let isNewLike = false;
    try {
      await prisma.reviewLike.create({ data: { userId, reviewId } });
      isNewLike = true;
    } catch (e: any) {
      if (e?.code === "P2002") {
        isNewLike = false; // already liked — no-op, no notification
      } else {
        throw e;
      }
    }

    // Notify the review author of a genuinely new like. Best-effort:
    // createNotification self-guards (no-op if author liked own review)
    // and never throws.
    if (isNewLike) {
      await createNotification(
        {
          recipientUserId: review.userId,
          actorUserId: userId,
          type: NotificationType.REVIEW_LIKE,
          entityId: reviewId,
          // showId lets the UI deep-link to the show page where the
          // review renders (there is no standalone /review/:id route).
          metadata: { showId: review.showId },
        },
        { prisma },
      );
    }

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
    const userId = await requireVerifiedActiveUserId(request, reply);
    if (!userId) return;
    const { reviewId } = request.params as { reviewId: string };
    const body = request.body as { body?: unknown };
    const result = await createComment(
      {
        reviewId,
        userId,
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

    // Notify the review author of a new comment. Best-effort + self-
    // guarded; entityId is the reviewId so the recipient lands on the
    // review, commentId rides along in metadata.
    await createNotification(
      {
        recipientUserId: result.reviewAuthorUserId,
        actorUserId: request.user.userId,
        type: NotificationType.REVIEW_COMMENT,
        entityId: result.comment.reviewId,
        metadata: { showId: result.reviewShowId, commentId: result.comment.id },
      },
      { prisma },
    );

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
      ...NOT_BLOCKED,
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
            comments: NOT_BLOCKED_COUNT,
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
  const query = request.query as {
    cursor?: string;
    limit?: string;
    sort?: string;
    offset?: string;
  };
  const limit = parseLimit(query.limit);
  const cursor = parseCursor(query.cursor);
  // "top" ranks by likes across the artist's WHOLE review history (the
  // artist page's default) rather than only the most recent page.
  //
  // The two sorts paginate differently on purpose: "recent" uses the
  // publishedAt cursor, which is meaningless under like-ranking, so
  // "top" uses an offset instead. Its ordering carries explicit
  // tie-breakers (likes -> publishedAt -> id) so that reviews with equal
  // like counts keep a deterministic order across offset requests and
  // cannot reshuffle or be skipped between pages.
  const sortTop = query.sort === "top";
  const rawOffset = Number(query.offset);
  const offset =
    sortTop && Number.isFinite(rawOffset) && rawOffset > 0
      ? Math.floor(rawOffset)
      : 0;

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
      where: { ...NOT_BLOCKED, show: { artistId: id } },
      _count: true,
      _avg: { ratingOverall: true },
    });

    // Reviews page. "recent" = publishedAt desc with cursor pagination;
    // "top" = most-liked first (ties broken by recency) across the full
    // history, unpaginated for now.
    const reviews = await prisma.review.findMany({
      where: {
        ...NOT_BLOCKED,
        show: { artistId: id },
        ...(cursor && !sortTop ? { publishedAt: { lt: cursor } } : {}),
      },
      orderBy: sortTop
        ? [
            { likes: { _count: "desc" } },
            { publishedAt: "desc" },
            { id: "desc" },
          ]
        : [{ publishedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(sortTop && offset > 0 ? { skip: offset } : {}),
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
            comments: NOT_BLOCKED_COUNT,
          },
        },
      },
    });

    const reviewIds = reviews.map((r) => r.id);
    const likedSet = await loadViewerLikedSet(viewerId, reviewIds);

    const reviewsHasMore = reviews.length > limit;
    const reviewsPage = reviewsHasMore ? reviews.slice(0, limit) : reviews;
    const reviewsLast = reviewsPage[reviewsPage.length - 1];
    // Cursor is publishedAt-based, which is meaningless under top-ranking:
    // "recent" paginates by cursor, "top" by offset.
    const reviewsNextCursor =
      !sortTop && reviewsHasMore && reviewsLast?.publishedAt
        ? new Date(reviewsLast.publishedAt).toISOString()
        : null;
    const topNextOffset =
      sortTop && reviewsHasMore ? offset + reviewsPage.length : null;

    return {
      id: artist.id,
      name: artist.name,
      sort: sortTop ? "top" : "recent",
      topNextOffset,
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
          where: { ...NOT_BLOCKED, showId: id },
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
        ...NOT_BLOCKED,
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
            comments: NOT_BLOCKED_COUNT,
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

// User search. Auth-optional: signed-in viewers get isFollowing per row
// and are excluded from their own results. Soft-deleted/anonymized users
// are excluded. Limit 20, no pagination.
//
// Registered before /users/:handle: Fastify's radix router prefers
// literal segments over params, but keeping source order aligned avoids
// confusion.
app.get("/users/search", async (request, reply) => {
  const q = ((request.query as { q?: string }).q ?? "").trim();
  if (q.length < 2) return reply.status(200).send({ items: [] });

  const viewerId = await getOptionalUserId(request);

  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      anonymizedAt: null,
      ...(viewerId ? { NOT: { id: viewerId } } : {}),
      OR: [
        { handle: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
      ],
    },
    select: {
      handle: true,
      name: true,
      avatarUrl: true,
      _count: {
        select: {
          followers: true,
          reviews: NOT_BLOCKED_COUNT,
          attendances: true,
        },
      },
      ...(viewerId
        ? {
            followers: {
              where: { followerId: viewerId },
              select: { id: true },
              take: 1,
            },
          }
        : {}),
    },
    take: 20,
    orderBy: [{ handle: "asc" }],
  });

  return reply.status(200).send({
    items: users.map((u) => ({
      handle: u.handle,
      name: u.name,
      avatarUrl: u.avatarUrl,
      followerCount: u._count.followers,
      reviewCount: u._count.reviews,
      // One Attendance row per (user, show) pair, so this is also the
      // distinct-show count — matches the "shows attended" displayed on
      // /user/:handle.
      attendedShowCount: u._count.attendances,
      isFollowing: viewerId
        ? Array.isArray((u as { followers?: unknown[] }).followers) &&
          (u as { followers: unknown[] }).followers.length > 0
        : false,
    })),
  });
});

app.get("/users/:handle", async (request, reply) => {
  const { handle } = request.params as { handle: string };
  const viewerId = await getOptionalUserId(request);
  const query = request.query as {
    cursor?: string;
    limit?: string;
    historyCursor?: string;
    historyLimit?: string;
  };
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
        // Counts folded into this query on purpose. DATABASE_URL pins
        // connection_limit=1, so a Promise.all of separate queries still
        // serializes on the single connection — the only way to cut
        // latency is to issue FEWER round-trips, not concurrent ones.
        _count: {
          select: {
            followers: true,
            following: true,
            attendances: true,
            reviews: NOT_BLOCKED_COUNT,
          },
        },
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
    // --- Unified concert history -------------------------------------
    // One chronological record of this person's concert life: reviews
    // they wrote, plus shows they marked attended but have NOT reviewed.
    // A show appears exactly once — if a VISIBLE review exists it renders
    // as a review; otherwise (including when their only review is
    // BLOCKED) it falls back to attended-only, so a concert is never
    // erased from their history.
    //
    // Paginated with a COMPOSITE cursor "<showLocalDateISO>|<showId>",
    // matching the merge order (localDate desc, show.id desc). The same
    // cursor is pushed into BOTH source queries so the merged stream
    // pages as one chronological sequence — the client never paginates
    // reviews and attendance separately.
    const HISTORY_PAGE = parseLimit(query.historyLimit);
    const historyCursor = parseHistoryCursor(query.historyCursor);
    // Each source must supply a full page on its own, since a page can
    // legitimately be all reviews or all attendances.
    const HISTORY_FETCH = HISTORY_PAGE + 1;
    const historyWhereShow = historyCursor
      ? {
          OR: [
            { localDate: { lt: historyCursor.localDate } },
            {
              localDate: historyCursor.localDate,
              id: { lt: historyCursor.showId },
            },
          ],
        }
      : {};

    const [viewerFollow, historyReviews, historyAttendances] =
      await Promise.all([
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
      // History: visible reviews, newest show first.
      prisma.review.findMany({
        where: {
          ...NOT_BLOCKED,
          userId: user.id,
          ...(historyCursor ? { show: historyWhereShow } : {}),
        },
        orderBy: [
          { show: { localDate: "desc" } },
          { show: { id: "desc" } },
        ],
        take: HISTORY_FETCH,
        include: {
          show: {
            select: {
              id: true,
              localDate: true,
              artist: { select: { id: true, name: true } },
              venue: { select: { name: true, city: true } },
            },
          },
          _count: { select: { likes: true, comments: NOT_BLOCKED_COUNT } },
        },
      }),
      // History: attendances with no VISIBLE review by this user.
      prisma.attendance.findMany({
        where: {
          userId: user.id,
          show: {
            reviews: { none: { ...NOT_BLOCKED, userId: user.id } },
            ...historyWhereShow,
          },
        },
        orderBy: [
          { show: { localDate: "desc" } },
          { show: { id: "desc" } },
        ],
        take: HISTORY_FETCH,
        select: {
          show: {
            select: {
              id: true,
              localDate: true,
              artist: { select: { id: true, name: true } },
              venue: { select: { name: true, city: true } },
            },
          },
        },
      }),
    ]);

    const attendedShowCount = user._count.attendances;
    const followerCount = user._count.followers;
    const followingCount = user._count.following;
    const reviewCount = user._count.reviews;

    const likedSet = await loadViewerLikedSet(
      viewerId,
      historyReviews.map((r) => r.id),
    );

    const mergedHistory = [
      ...historyReviews.map((r) => ({
        kind: "review" as const,
        show: r.show,
        review: {
          id: r.id,
          ratingOverall: r.ratingOverall,
          reviewTextRaw: r.reviewTextRaw,
          publishedAt: r.publishedAt,
          likeCount: r._count.likes,
          commentCount: r._count.comments,
          liked: likedSet.has(r.id),
        },
      })),
      ...historyAttendances.map((a) => ({
        kind: "attended" as const,
        show: a.show,
        review: null,
      })),
    ].sort((a, b) => {
      const d = b.show.localDate.getTime() - a.show.localDate.getTime();
      return d !== 0 ? d : b.show.id.localeCompare(a.show.id);
    });

    // Trim the merged stream to one page. Because each source fetched a
    // full page + 1, anything beyond the page boundary is guaranteed to
    // be re-fetchable from the cursor, so nothing is skipped.
    const historyHasMore = mergedHistory.length > HISTORY_PAGE;
    const history = mergedHistory.slice(0, HISTORY_PAGE);
    const historyLast = history[history.length - 1];
    const historyNextCursor =
      historyHasMore && historyLast
        ? `${historyLast.show.localDate.toISOString()}|${historyLast.show.id}`
        : null;

    // Legacy `reviews` field, kept for response-shape compatibility but
    // now DERIVED from the history reviews instead of costing its own
    // query. `reviewsNextCursor` is null because history is capped rather
    // than cursor-paginated (see HISTORY_CAP).
    const legacyReviews = history
      .filter((h) => h.review)
      .slice(0, limit)
      .map((h) => ({
        id: h.review!.id,
        ratingOverall: h.review!.ratingOverall,
        reviewTextRaw: h.review!.reviewTextRaw,
        publishedAt: h.review!.publishedAt,
        likeCount: h.review!.likeCount,
        commentCount: h.review!.commentCount,
        liked: h.review!.liked,
        show: h.show,
      }));

    return {
      id: user.id,
      handle: user.handle,
      name: user.name,
      avatarUrl: user.avatarUrl,
      joinedAt: user.createdAt,
      attendedShowCount,
      reviewCount,
      followerCount,
      followingCount,
      followedByMe: !!viewerFollow,
      history,
      historyNextCursor,
      reviews: legacyReviews,
      reviewsNextCursor: null,
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
  const followerId = await requireActiveUserId(request, reply);
  if (!followerId) return;
  const { handle } = request.params as { handle: string };

  const target = await prisma.user.findUnique({ where: { handle } });
  if (!target) {
    return reply.status(404).send({ error: "User not found" });
  }
  if (target.id === followerId) {
    return reply.status(400).send({ error: "You can't follow yourself" });
  }

  try {
    // create-or-catch-P2002 (not upsert) so we know whether this is a
    // genuinely new follow and notify only once. Self-follow is already
    // blocked above.
    let isNewFollow = false;
    try {
      await prisma.follow.create({
        data: { followerId, followingId: target.id },
      });
      isNewFollow = true;
    } catch (e: any) {
      if (e?.code === "P2002") {
        isNewFollow = false; // already following — no-op, no notification
      } else {
        throw e;
      }
    }

    if (isNewFollow) {
      await createNotification(
        {
          recipientUserId: target.id,
          actorUserId: followerId,
          type: NotificationType.FOLLOW,
          entityId: followerId,
        },
        { prisma },
      );
    }

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

// --- Notifications ---------------------------------------------------------

app.get("/notifications", async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: "Not authenticated" });
  }
  const { userId } = request.user;
  const query = request.query as { cursor?: string; limit?: string };
  const rawLimit = Number(query.limit);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_NOTIFICATIONS_LIMIT)
      : DEFAULT_NOTIFICATIONS_LIMIT;
  const cursor = parseCursor(query.cursor);

  try {
    const result = await listNotifications(
      { recipientUserId: userId, limit, cursor },
      { prisma },
    );
    return reply.status(200).send(result);
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({
      error: "Failed to load notifications",
      details: err?.message || String(err),
    });
  }
});

// Lightweight badge endpoint — the header bell renders on every page and
// only needs the count, not the full list.
app.get("/notifications/unread-count", async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: "Not authenticated" });
  }
  const { userId } = request.user;
  try {
    const count = await prisma.notification.count({
      where: { recipientUserId: userId, readAt: null },
    });
    return reply.status(200).send({ count });
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({ error: "Failed to count notifications" });
  }
});

app.post("/notifications/read", async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: "Not authenticated" });
  }
  const { userId } = request.user;
  const body = request.body as { id?: unknown };
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) {
    return reply.status(400).send({ error: "id is required" });
  }
  try {
    // Scope the update to the caller so one user can't mark another's
    // notification read. updateMany returns count 0 if not theirs /
    // not found — we report success either way (idempotent).
    const now = new Date();
    const result = await prisma.notification.updateMany({
      where: { id, recipientUserId: userId, readAt: null },
      data: { readAt: now },
    });
    return reply.status(200).send({ updated: result.count });
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({ error: "Failed to mark read" });
  }
});

app.post("/notifications/read-all", async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: "Not authenticated" });
  }
  const { userId } = request.user;
  try {
    const result = await prisma.notification.updateMany({
      where: { recipientUserId: userId, readAt: null },
      data: { readAt: new Date() },
    });
    return reply.status(200).send({ updated: result.count });
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({ error: "Failed to mark all read" });
  }
});

// --- Reports (user-facing) -------------------------------------------------

app.post("/reports", async (request, reply) => {
  const reporterUserId = await requireActiveUserId(request, reply);
  if (!reporterUserId) return;

  const body = request.body as {
    targetType?: unknown;
    targetId?: unknown;
    reason?: unknown;
    details?: unknown;
  };
  const targetType = typeof body.targetType === "string" ? body.targetType : "";
  const targetId = typeof body.targetId === "string" ? body.targetId : "";
  const reason = typeof body.reason === "string" ? body.reason : "";
  const details = typeof body.details === "string" ? body.details : null;
  if (!targetId) {
    return reply.status(400).send({ error: "targetId is required" });
  }

  try {
    const result = await createReport(
      { reporterUserId, targetType, targetId, reason, details },
      { prisma },
    );
    if (!result.ok) {
      const status = result.reason === "target_not_found" ? 404 : 400;
      return reply.status(status).send({ error: result.reason });
    }
    return reply.status(201).send({ reported: true, alreadyReported: result.alreadyReported });
  } catch (err: any) {
    app.log.error(err);
    Sentry.captureException(err);
    return reply.status(500).send({ error: "Failed to file report" });
  }
});

// --- Admin moderation ------------------------------------------------------

app.get("/admin/reports", async (request, reply) => {
  const adminId = await requireAdminUserId(request, reply);
  if (!adminId) return;
  try {
    const items = await listOpenReportsGrouped({ prisma });
    return reply.status(200).send({ items });
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({ error: "Failed to load reports" });
  }
});

// Moderation user-detail: profile + ALL their reviews (incl. blocked) +
// open reports against them, so the admin can judge before suspending.
app.get("/admin/users/:userId", async (request, reply) => {
  const adminId = await requireAdminUserId(request, reply);
  if (!adminId) return;
  const { userId } = request.params as { userId: string };
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        handle: true,
        name: true,
        avatarUrl: true,
        createdAt: true,
        suspendedAt: true,
        suspensionReason: true,
      },
    });
    if (!user) return reply.status(404).send({ error: "User not found" });
    const reviews = await prisma.review.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        reviewTextRaw: true,
        ratingOverall: true,
        moderationStatus: true,
        createdAt: true,
        showId: true,
      },
    });
    const openReportCount = await prisma.report.count({
      where: { targetType: "USER", targetId: userId, status: "OPEN" },
    });
    return reply.status(200).send({ user, reviews, openReportCount });
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({ error: "Failed to load user detail" });
  }
});

app.post("/admin/reports/:id/dismiss", async (request, reply) => {
  const adminId = await requireAdminUserId(request, reply);
  if (!adminId) return;
  const { id } = request.params as { id: string };
  const result = await dismissReport(id, adminId, { prisma, now: () => new Date() });
  if (!result.ok) return reply.status(404).send({ error: result.reason });
  return reply.status(200).send({ ok: true });
});

// Target-level actions share a small body { targetType, targetId }.
function readTarget(request: FastifyRequest): { targetType: string; targetId: string } {
  const b = request.body as { targetType?: unknown; targetId?: unknown };
  return {
    targetType: typeof b.targetType === "string" ? b.targetType : "",
    targetId: typeof b.targetId === "string" ? b.targetId : "",
  };
}

app.post("/admin/moderation/block", async (request, reply) => {
  const adminId = await requireAdminUserId(request, reply);
  if (!adminId) return;
  const { targetType, targetId } = readTarget(request);
  if (targetType !== "REVIEW" && targetType !== "COMMENT") {
    return reply.status(400).send({ error: "targetType must be REVIEW or COMMENT" });
  }
  if (!targetId) return reply.status(400).send({ error: "targetId is required" });
  const result = await blockContent(targetType, targetId, adminId, {
    prisma,
    now: () => new Date(),
  });
  if (!result.ok) return reply.status(404).send({ error: result.reason });
  return reply.status(200).send({ ok: true });
});

app.post("/admin/moderation/restore", async (request, reply) => {
  const adminId = await requireAdminUserId(request, reply);
  if (!adminId) return;
  const { targetType, targetId } = readTarget(request);
  if (targetType !== "REVIEW" && targetType !== "COMMENT") {
    return reply.status(400).send({ error: "targetType must be REVIEW or COMMENT" });
  }
  if (!targetId) return reply.status(400).send({ error: "targetId is required" });
  const result = await restoreContent(targetType, targetId, { prisma });
  if (!result.ok) return reply.status(404).send({ error: result.reason });
  return reply.status(200).send({ ok: true });
});

app.post("/admin/moderation/dismiss-target", async (request, reply) => {
  const adminId = await requireAdminUserId(request, reply);
  if (!adminId) return;
  const { targetType, targetId } = readTarget(request);
  if (
    targetType !== "REVIEW" &&
    targetType !== "COMMENT" &&
    targetType !== "USER"
  ) {
    return reply.status(400).send({ error: "invalid targetType" });
  }
  if (!targetId) return reply.status(400).send({ error: "targetId is required" });
  const result = await dismissTarget(targetType, targetId, adminId, {
    prisma,
    now: () => new Date(),
  });
  if (!result.ok) return reply.status(400).send({ error: result.reason });
  return reply.status(200).send({ ok: true });
});

app.post("/admin/moderation/suspend", async (request, reply) => {
  const adminId = await requireAdminUserId(request, reply);
  if (!adminId) return;
  const b = request.body as { userId?: unknown; reason?: unknown };
  const userId = typeof b.userId === "string" ? b.userId : "";
  const reason = typeof b.reason === "string" ? b.reason : null;
  if (!userId) return reply.status(400).send({ error: "userId is required" });
  if (userId === adminId) {
    return reply.status(400).send({ error: "You can't suspend yourself" });
  }
  const result = await suspendUser(userId, reason, adminId, {
    prisma,
    now: () => new Date(),
  });
  if (!result.ok) return reply.status(404).send({ error: result.reason });
  return reply.status(200).send({ ok: true });
});

app.post("/admin/moderation/unsuspend", async (request, reply) => {
  const adminId = await requireAdminUserId(request, reply);
  if (!adminId) return;
  const b = request.body as { userId?: unknown };
  const userId = typeof b.userId === "string" ? b.userId : "";
  if (!userId) return reply.status(400).send({ error: "userId is required" });
  const result = await unsuspendUser(userId, { prisma });
  if (!result.ok) return reply.status(404).send({ error: result.reason });
  return reply.status(200).send({ ok: true });
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