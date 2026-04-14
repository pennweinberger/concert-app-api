export default {
  async fetch(req: Request) {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q");

    if (!q) {
      return Response.json(
        { error: "Missing query param 'q'" },
        { status: 400 }
      );
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

      return Response.json({ items });
    } catch (err: any) {
      return Response.json(
        {
          error: "Failed to fetch artists",
          details: err?.message || String(err),
        },
        { status: 500 }
      );
    }
  },
};
