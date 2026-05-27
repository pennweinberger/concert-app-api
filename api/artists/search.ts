import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
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
        q,
      )}&apikey=${apiKey}`,
    );

    const data = await tmRes.json();

    const items =
      data?._embedded?.events?.map((event: any) => ({
        id: event.id,
        name: event.name,
      })) || [];

    return res.status(200).json({ items });
  } catch (err: any) {
    return res.status(500).json({
      error: "Failed to fetch artists",
      details: err?.message || String(err),
    });
  }
}
