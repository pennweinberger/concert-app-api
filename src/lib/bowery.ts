// Bowery / AEG NYC feed HTTP client. Single source: the AEG regional
// JSON blob that serves The Bowery Presents' East Coast event calendar.
// One HTTPS GET per ingest run covers all 7 priority NYC venues
// (Brooklyn Steel, MHoW, Terminal 5, Webster Hall, Racket, Forest Hills
// Stadium, Under the K Bridge Park) plus the rest of the feed which the
// orchestrator filters out via the venue allowlist.
//
// Politeness: non-AI User-Agent, gated by BOWERY_INGEST_ENABLED so the
// route stays inert when the env var isn't set.

const FEED_URL =
  "https://aegwebprod.blob.core.windows.net/json/events/59/events.json";
const PER_VENUE_FEED_BASE =
  "https://aegwebprod.blob.core.windows.net/json/events/";
const USER_AGENT =
  "Afterset-IngestionBot/1.0 (+https://afterset-pied.vercel.app/bot)";

export class BoweryError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "BoweryError";
  }
}
export class BoweryDisabledError extends BoweryError {
  constructor() {
    super("BOWERY_INGEST_ENABLED is not set");
    this.name = "BoweryDisabledError";
  }
}
export class BoweryFetchError extends BoweryError {
  constructor(message: string, status?: number) {
    super(message, status);
    this.name = "BoweryFetchError";
  }
}

export type BoweryFeedResponse = {
  rawJson: unknown;
  etag: string | null;
  lastModified: string | null;
};

export async function fetchBoweryFeed(): Promise<BoweryFeedResponse> {
  return fetchUrl(FEED_URL);
}

// Per-venue feeds carry venue-specific events that may not appear in the
// regional feed. Concrete case: Forest Hills Stadium is multi-promoter
// (Live Nation, AEG Presents, Madison House, etc.); its per-venue feed
// /events/58/ has events the Bowery-only regional feed /events/59/ omits.
// Pure Bowery-Presents venues (Brooklyn Steel, MHoW, Terminal 5, Webster
// Hall) point at the regional feed from their own pages, so they don't
// need this supplement.
export async function fetchBoweryPerVenueFeed(
  perVenueFeedId: string,
): Promise<BoweryFeedResponse> {
  if (!/^[0-9]+$/.test(perVenueFeedId)) {
    throw new BoweryFetchError(
      `Invalid per-venue feed id: ${perVenueFeedId}`,
    );
  }
  return fetchUrl(`${PER_VENUE_FEED_BASE}${perVenueFeedId}/events.json`);
}

async function fetchUrl(url: string): Promise<BoweryFeedResponse> {
  if (process.env.BOWERY_INGEST_ENABLED !== "true") {
    throw new BoweryDisabledError();
  }
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new BoweryFetchError(
      `Bowery feed ${res.status} (${url}): ${body.slice(0, 200)}`,
      res.status,
    );
  }
  const rawJson = (await res.json()) as unknown;
  return {
    rawJson,
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
  };
}
