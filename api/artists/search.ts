import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const q = req.query.q as string | undefined;

  if (!q) {
    return res.status(400).json({ error: "Missing query param 'q'" });
  }

  const apiKey = process.env.TICKETMASTER_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "Missing TICKETMASTER_API_KEY" });
  }

  try {
    const tmRes = await fetch(
      `https://app.ticketmaster.com/discovery/v2/events.json?keyword=${encodeURIComponent(
        q
      )}&apikey=${apiKey}`
    );

    const data = await tmRes.json();

    const events = data?._embedded?.events || [];

    const items = events.map((event: any) => ({
      provider: "ticketmaster",
      providerEventId: event.id,
      artist: event.name,
      venue: event._embedded?.venues?.[0]?.name || null,
      city: event._embedded?.venues?.[0]?.city?.name || null,
      localDate: event.dates?.start?.localDate || null,
      ticketUrl: event.url || null,
    }));

    return res.status(200).json({ items });
  } catch (err: any) {
    return res.status(500).json({
      error: "Failed to fetch shows",
      details: err?.message || String(err),
    });
  }
}