import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import * as Sentry from "@sentry/node";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

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

// TEMPORARY: in-memory rate limit store. Each Vercel function instance
// has its own store, so the effective limit is (instances * limit). For
// real production launch this should be replaced with a Redis/Upstash
// backend so limits are global across instances. See follow-up list.
app.register(rateLimit, {
  global: false,
  // Default fallback config; per-route limits are attached at the
  // route definition site below.
  max: 1000,
  timeWindow: "1 minute",
});

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
  return handle;
}

function validPassword(raw: unknown): raw is string {
  return typeof raw === "string" && raw.length >= 8 && raw.length <= 200;
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
  {
    config: {
      rateLimit: { max: 3, timeWindow: "1 hour" },
    },
  },
  async (request, reply) => {
  const body = request.body as { handle?: unknown; password?: unknown };

  const handle = normalizeHandle(body.handle);
  if (!handle) {
    return reply.status(400).send({
      error: "Handle must be 3-20 chars, letters/numbers/underscore only",
    });
  }
  if (!validPassword(body.password)) {
    return reply.status(400).send({
      error: "Password must be at least 8 characters",
    });
  }

  const existing = await prisma.user.findUnique({ where: { handle } });
  if (existing) {
    return reply.status(409).send({ error: "Handle already taken" });
  }

  const passwordHash = await bcrypt.hash(body.password, 10);

  try {
    const user = await prisma.user.create({
      data: { handle, passwordHash },
    });

    const token = await reply.jwtSign(
      { userId: user.id, handle: user.handle },
      { expiresIn: "30d" },
    );

    return reply.status(201).send({
      token,
      user: { id: user.id, handle: user.handle },
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
  {
    config: {
      rateLimit: { max: 5, timeWindow: "1 minute" },
    },
  },
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
    user: { id: user.id, handle: user.handle },
  };
});

app.get("/auth/me", async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: "Not authenticated" });
  }
  return { user: request.user };
});

// --- End auth --------------------------------------------------------------

app.get(
  "/artists/search",
  {
    config: {
      rateLimit: { max: 60, timeWindow: "1 minute" },
    },
  },
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
  {
    config: {
      rateLimit: { max: 60, timeWindow: "1 minute" },
    },
  },
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

    // Artist
    let artistRecord = await prisma.artist.findFirst({
      where: { name: artist },
    });

    if (!artistRecord) {
      artistRecord = await prisma.artist.create({
        data: { name: artist },
      });
    }

    // Venue
    let venueRecord = await prisma.venue.findFirst({
      where: { name: venue, city },
    });

    if (!venueRecord) {
      venueRecord = await prisma.venue.create({
        data: { name: venue, city },
      });
    }

    // Check existing show
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
      return {
        showId: existingShow.id,
        existing: true,
      };
    }

    // Create show
    const showRecord = await prisma.show.create({
      data: {
        artistId: artistRecord.id,
        venueId: venueRecord.id,
        startDatetimeUtc: parsedDate,
        localDate: parsedDate,
      },
    });

    return {
      showId: showRecord.id,
      existing: false,
    };
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({
      error: "Failed to confirm show",
      details: err?.message || String(err),
    });
  }
});

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
        _count: { select: { likes: true } },
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
        _count: { select: { likes: true } },
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
        _count: { select: { likes: true } },
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
      },
    });

    if (!user) {
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
        _count: { select: { likes: true } },
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