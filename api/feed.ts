import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export default {
  async fetch() {
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

      return Response.json({ items });
    } catch (err: any) {
      return Response.json(
        {
          error: "Failed to fetch feed",
          details: err?.message || String(err),
        },
        { status: 500 }
      );
    }
  },
};