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
      where: {
        name: venue,
        city,
      },
    });

    if (!venueRecord) {
      venueRecord = await prisma.venue.create({
        data: { name: venue, city },
      });
    }

    // 3. Check if show already exists
    const existingShow = await prisma.show.findFirst({
      where: {
        artistId: artistRecord.id,
        venueId: venueRecord.id,
        localDate: new Date(`${localDate}T00:00:00.000Z`),
      },
    });

    if (existingShow) {
      return {
        showId: existingShow.id,
        existing: true,
      };
    }

    // 4. Create show
    const showRecord = await prisma.show.create({
      data: {
        artistId: artistRecord.id,
        venueId: venueRecord.id,
        startDatetimeUtc: new Date(`${localDate}T00:00:00.000Z`),
        localDate: new Date(`${localDate}T00:00:00.000Z`),
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