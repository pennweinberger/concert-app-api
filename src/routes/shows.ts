import { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export default async function showsRoutes(app: FastifyInstance) {
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
        data?._embedded?.events?.map((event: any) => ({
          provider: "ticketmaster",
          providerEventId: event.id,
          artist: event.name,
          venue: event._embedded?.venues?.[0]?.name,
          city: event._embedded?.venues?.[0]?.city?.name,
          localDate: event.dates?.start?.localDate,
          ticketUrl: event.url,
        })) || [];

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
      const artistRecord = await prisma.artist.create({
        data: {
          name: artist,
        },
      });

      const venueRecord = await prisma.venue.create({
        data: {
          name: venue,
          city,
        },
      });

      const showRecord = await prisma.show.create({
        data: {
          artistId: artistRecord.id,
          venueId: venueRecord.id,
          startDatetimeUtc: new Date(`${localDate}T00:00:00.000Z`),
          localDate: new Date(`${localDate}T00:00:00.000Z`),
        },
      });

      return { showId: showRecord.id };
       } catch (err: any) {
      app.log.error(err);
      return reply.status(500).send({
        error: "Failed to confirm show",
        details: err?.message || String(err),
      });
    }
  });
}
