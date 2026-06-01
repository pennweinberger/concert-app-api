import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "./_lib/prisma.js";

export default async function handler(
  _req: VercelRequest,
  res: VercelResponse,
) {
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
      },
    });

    const items = reviews.map((review) => ({
      reviewId: review.id,
      userHandle: review.user.handle,
      ratingOverall: review.ratingOverall,
      reviewTextRaw: review.reviewTextRaw,
      publishedAt: review.publishedAt,
      show: {
        id: review.show.id,
        localDate: review.show.localDate,
        artistId: review.show.artist.id,
        artist: review.show.artist.name,
        venue: review.show.venue.name,
        city: review.show.venue.city,
      },
    }));

    return res.status(200).json({ items });
  } catch (err: any) {
    return res.status(500).json({
      error: "Failed to fetch feed",
      details: err?.message || String(err),
    });
  }
}
