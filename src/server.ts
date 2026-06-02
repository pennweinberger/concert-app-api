import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config();

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
const app = Fastify({ logger: true });

app.register(cors, {
  origin: true,
  allowedHeaders: ["Content-Type", "Authorization"],
});

app.register(fastifyJwt, { secret: JWT_SECRET });

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

app.get("/health", async () => {
  return { ok: true };
});

// --- Auth ------------------------------------------------------------------

app.post("/auth/register", async (request, reply) => {
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

app.post("/auth/login", async (request, reply) => {
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

app.get("/artists/search", async (request, reply) => {
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

app.get("/shows/search", async (request, reply) => {
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
    showId: string;
    ratingOverall: number;
    reviewTextRaw: string;
  };

  const { showId, ratingOverall, reviewTextRaw } = body;

  if (!showId || !ratingOverall || !reviewTextRaw) {
    return reply.status(400).send({
      error: "showId, ratingOverall, and reviewTextRaw are required",
    });
  }

  try {
    const review = await prisma.review.create({
      data: {
        userId,
        showId,
        ratingOverall,
        reviewTextRaw,
        moderationStatus: "ALLOWED",
        publishedAt: new Date(),
      },
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
    if (
      typeof body.reviewTextRaw !== "string" ||
      body.reviewTextRaw.trim().length === 0
    ) {
      return reply
        .status(400)
        .send({ error: "reviewTextRaw must be non-empty" });
    }
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
  try {
    const reviews = await prisma.review.findMany({
      orderBy: { publishedAt: "desc" },
      include: {
        user: true,
        show: {
          include: {
            artist: true,
            venue: true,
          },
        },
        likes: { select: { userId: true } },
      },
    });

    const items = reviews.map((review) => ({
      reviewId: review.id,
      userHandle: review.user.handle,
      ratingOverall: review.ratingOverall,
      reviewTextRaw: review.reviewTextRaw,
      publishedAt: review.publishedAt,
      likeCount: review.likes.length,
      liked: viewerId
        ? review.likes.some((l) => l.userId === viewerId)
        : false,
      show: {
        id: review.show.id,
        localDate: review.show.localDate,
        artistId: review.show.artist.id,
        artist: review.show.artist.name,
        venue: review.show.venue.name,
        city: review.show.venue.city,
      },
    }));

    return { items };
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

  try {
    const artist = await prisma.artist.findUnique({
      where: { id },
      include: {
        shows: {
          include: {
            reviews: {
              include: {
                user: true,
                likes: { select: { userId: true } },
              },
            },
          },
        },
      },
    });

    if (!artist) {
      return reply.status(404).send({ error: "Artist not found" });
    }

    const allReviews = artist.shows.flatMap((show) =>
      show.reviews.map((review) => ({
        review,
        show: { id: show.id, localDate: show.localDate },
      })),
    );

    const average =
      allReviews.length > 0
        ? allReviews.reduce((sum, r) => sum + r.review.ratingOverall, 0) /
          allReviews.length
        : 0;

    return {
      id: artist.id,
      name: artist.name,
      averageRating: Number(average.toFixed(1)),
      reviewCount: allReviews.length,
      reviews: allReviews.map(({ review, show }) => ({
        id: review.id,
        userHandle: review.user.handle,
        ratingOverall: review.ratingOverall,
        reviewTextRaw: review.reviewTextRaw,
        likeCount: review.likes.length,
        liked: viewerId
          ? review.likes.some((l) => l.userId === viewerId)
          : false,
        show: { id: show.id, localDate: show.localDate },
      })),
    };
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({
      error: "Failed to fetch artist",
      details: err?.message || String(err),
    });
  }
});

app.get("/shows/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const viewerId = await getOptionalUserId(request);

  try {
    const show = await prisma.show.findUnique({
      where: { id },
      include: {
        artist: true,
        venue: true,
        reviews: {
          orderBy: { publishedAt: "desc" },
          include: {
            user: true,
            likes: { select: { userId: true } },
          },
        },
      },
    });

    if (!show) {
      return reply.status(404).send({ error: "Show not found" });
    }

    const average =
      show.reviews.length > 0
        ? show.reviews.reduce((sum, r) => sum + r.ratingOverall, 0) /
          show.reviews.length
        : 0;

    return {
      id: show.id,
      localDate: show.localDate,
      artist: {
        id: show.artist.id,
        name: show.artist.name,
      },
      venue: {
        name: show.venue.name,
        city: show.venue.city,
      },
      averageRating: Number(average.toFixed(1)),
      reviewCount: show.reviews.length,
      reviews: show.reviews.map((review) => ({
        id: review.id,
        userHandle: review.user.handle,
        ratingOverall: review.ratingOverall,
        reviewTextRaw: review.reviewTextRaw,
        publishedAt: review.publishedAt,
        likeCount: review.likes.length,
        liked: viewerId
          ? review.likes.some((l) => l.userId === viewerId)
          : false,
      })),
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

  try {
    const user = await prisma.user.findUnique({
      where: { handle },
      include: {
        reviews: {
          orderBy: { publishedAt: "desc" },
          include: {
            show: {
              include: {
                artist: true,
                venue: true,
              },
            },
            likes: { select: { userId: true } },
          },
        },
      },
    });

    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    const distinctShows = new Set(user.reviews.map((r) => r.showId)).size;
    const averageRating =
      user.reviews.length > 0
        ? user.reviews.reduce((sum, r) => sum + r.ratingOverall, 0) /
          user.reviews.length
        : 0;

    return {
      handle: user.handle,
      joinedAt: user.createdAt,
      showCount: distinctShows,
      reviewCount: user.reviews.length,
      averageRating: Number(averageRating.toFixed(1)),
      reviews: user.reviews.map((review) => ({
        id: review.id,
        ratingOverall: review.ratingOverall,
        reviewTextRaw: review.reviewTextRaw,
        publishedAt: review.publishedAt,
        likeCount: review.likes.length,
        liked: viewerId
          ? review.likes.some((l) => l.userId === viewerId)
          : false,
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
    };
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({
      error: "Failed to fetch user",
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