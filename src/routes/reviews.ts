import { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export default async function reviewsRoutes(app: FastifyInstance) {
   app.post("/reviews", async (request, reply) => {
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
          userId: "demo-user",
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

  app.get("/feed", async (_request, reply) => {
    try {
      const reviews = await prisma.review.findMany({
        orderBy: {
          publishedAt: "desc",
        },
        include: {
          show: {
            include: {
              artist: true,
              venue: true,
            },
          },
        },
      });

      const items = reviews.map((review) => ({
        reviewId: review.id,
        ratingOverall: review.ratingOverall,
        reviewTextRaw: review.reviewTextRaw,
        publishedAt: review.publishedAt,
        show: {
          id: review.show.id,
          localDate: review.show.localDate,
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
}