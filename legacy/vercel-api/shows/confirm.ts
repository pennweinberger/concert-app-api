import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "../_lib/prisma.js";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { artist, venue, city, localDate } = (req.body || {}) as {
    artist?: string;
    venue?: string;
    city?: string;
    localDate?: string;
  };

  if (!artist || !venue || !city || !localDate) {
    return res.status(400).json({
      error: "artist, venue, city, and localDate are required",
    });
  }

  try {
    const parsedDate = new Date(`${localDate}T00:00:00.000Z`);

    // 1. Find or create artist
    let artistRecord = await prisma.artist.findFirst({
      where: { name: artist },
    });

    if (!artistRecord) {
      artistRecord = await prisma.artist.create({
        data: { name: artist },
      });
    }

    // 2. Find or create venue
    let venueRecord = await prisma.venue.findFirst({
      where: { name: venue, city },
    });

    if (!venueRecord) {
      venueRecord = await prisma.venue.create({
        data: { name: venue, city },
      });
    }

    // 3. Idempotent show insert via composite unique key
    //    @@unique([artistId, venueId, localDate]) on Show
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
      return res.status(200).json({
        showId: existingShow.id,
        existing: true,
      });
    }

    const showRecord = await prisma.show.create({
      data: {
        artistId: artistRecord.id,
        venueId: venueRecord.id,
        startDatetimeUtc: parsedDate,
        localDate: parsedDate,
      },
    });

    return res.status(200).json({
      showId: showRecord.id,
      existing: false,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: "Failed to confirm show",
      details: err?.message || String(err),
    });
  }
}
