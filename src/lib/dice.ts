// DICE HTTP client — venue page fetch only.
//
// Scope: polite single-purpose client for DICE venue pages. The
// venue-page JSON-LD contains everything we need per event, so we never
// fetch per-event pages.
//
// Politeness:
//   - User-Agent identifies as a non-AI ingestion bot (DICE's
//     robots.txt explicitly blocks AI-class bots; ours must not look
//     like one).
//   - Throttle: minimum interval between requests in this process.
//   - Lazy env-var gate: DICE_INGEST_ENABLED=true required, else the
//     client returns DiceDisabledError without making any HTTP call.
//
// Errors are translated into typed classes so the orchestrator can
// branch on cause (rate-limit vs. disabled vs. other).

const VENUE_BASE_URL = "https://dice.fm/venue/";
const USER_AGENT =
  "Afterset-IngestionBot/1.0 (+https://afterset-pied.vercel.app/bot)";
const MIN_INTERVAL_MS = 1000;

let lastRequestAt = 0;

export class DiceError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "DiceError";
  }
}
export class DiceDisabledError extends DiceError {
  constructor() {
    super("DICE_INGEST_ENABLED is not set");
    this.name = "DiceDisabledError";
  }
}
export class DiceRateLimitError extends DiceError {
  constructor(message: string, status?: number) {
    super(message, status);
    this.name = "DiceRateLimitError";
  }
}
export class DiceFetchError extends DiceError {
  constructor(message: string, status?: number) {
    super(message, status);
    this.name = "DiceFetchError";
  }
}

async function throttle() {
  const now = Date.now();
  const elapsed = now - lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

// Fetch the venue page HTML for a DICE short id. DICE accepts
// short-id-only URLs at /venue/{shortId} and renders the same JSON-LD
// as the canonical /venue/{slug}-{shortId} URL.
export async function fetchVenuePageHtml(shortId: string): Promise<string> {
  if (process.env.DICE_INGEST_ENABLED !== "true") {
    throw new DiceDisabledError();
  }
  if (!/^[a-z0-9]+$/i.test(shortId)) {
    throw new DiceFetchError(`Invalid DICE short id: ${shortId}`);
  }

  await throttle();

  const url = `${VENUE_BASE_URL}${encodeURIComponent(shortId)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html",
    },
  });

  if (res.status === 429) {
    throw new DiceRateLimitError("DICE rate limit hit", 429);
  }
  if (res.status === 403) {
    throw new DiceFetchError(
      `DICE returned 403 — User-Agent may be in the block list`,
      403,
    );
  }
  if (!res.ok) {
    const body = await res.text();
    throw new DiceFetchError(
      `DICE ${res.status} for shortId=${shortId}: ${body.slice(0, 200)}`,
      res.status,
    );
  }

  return res.text();
}
