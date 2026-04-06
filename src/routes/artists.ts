import { FastifyInstance } from "fastify";

export default async function artistsRoutes(app: FastifyInstance) {
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
}
