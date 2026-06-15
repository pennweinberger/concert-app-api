// setlist.fm REST client.
//
// Scope: self-contained HTTP client for the official setlist.fm API. No DB
// access. Used by the nightly ingestion cron + matching layer.
//
// Rate limit: a single-process minimum interval between requests, to stay
// well under setlist.fm's documented limits regardless of how aggressively
// callers invoke us. setlist.fm allows ~2 req/sec; we throttle to 1 req/sec
// to leave headroom.
//
// Errors: every non-2xx response is translated into a typed Error subclass
// so callers can branch on cause (auth vs rate-limit vs not-found) without
// inspecting raw status codes.

const BASE_URL = "https://api.setlist.fm/rest/1.0";
const MIN_INTERVAL_MS = 1000;

let lastRequestAt = 0;

export class SetlistfmError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "SetlistfmError";
  }
}
export class SetlistfmAuthError extends SetlistfmError {
  constructor(message: string, status?: number) {
    super(message, status);
    this.name = "SetlistfmAuthError";
  }
}
export class SetlistfmNotFoundError extends SetlistfmError {
  constructor(message: string, status?: number) {
    super(message, status);
    this.name = "SetlistfmNotFoundError";
  }
}
export class SetlistfmRateLimitError extends SetlistfmError {
  constructor(message: string, status?: number) {
    super(message, status);
    this.name = "SetlistfmRateLimitError";
  }
}

// Narrow types — only the fields the matching layer actually consumes.
// Setlist.fm returns more; we deliberately don't model it.
export type SetlistfmArtist = {
  mbid?: string;
  name: string;
};

export type SetlistfmCity = {
  name: string;
  state?: string;
  stateCode?: string;
  country: { code: string; name: string };
};

export type SetlistfmVenue = {
  id: string;
  name: string;
  city: SetlistfmCity;
};

export type SetlistfmSong = {
  name: string;
};

export type SetlistfmSetGroup = {
  name?: string;
  song?: SetlistfmSong[];
};

export type SetlistfmSetlist = {
  id: string;
  eventDate: string; // "dd-MM-yyyy"
  artist: SetlistfmArtist;
  venue: SetlistfmVenue;
  tour?: { name: string };
  sets?: { set?: SetlistfmSetGroup[] };
  url: string; // canonical setlist.fm URL (used for attribution)
};

export type SetlistfmSearchResponse = {
  type: "setlists";
  itemsPerPage: number;
  page: number;
  total: number;
  setlist: SetlistfmSetlist[];
};

async function throttle() {
  const now = Date.now();
  const elapsed = now - lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

async function setlistfmGet<T>(path: string): Promise<T> {
  const apiKey = process.env.SETLISTFM_API_KEY;
  if (!apiKey) {
    throw new SetlistfmError("SETLISTFM_API_KEY is not configured");
  }

  await throttle();

  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Accept: "application/json",
      "x-api-key": apiKey,
      "User-Agent": "Afterset/1.0 (+https://afterset-pied.vercel.app)",
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new SetlistfmAuthError(
      `setlist.fm auth failed (${res.status})`,
      res.status
    );
  }
  if (res.status === 404) {
    throw new SetlistfmNotFoundError(
      `setlist.fm not found: ${path}`,
      404
    );
  }
  if (res.status === 429) {
    throw new SetlistfmRateLimitError(
      "setlist.fm rate limit exceeded",
      429
    );
  }
  if (!res.ok) {
    const body = await res.text();
    throw new SetlistfmError(
      `setlist.fm ${res.status}: ${body.slice(0, 200)}`,
      res.status
    );
  }

  return res.json() as Promise<T>;
}

export async function searchSetlistsByArtistMbid(
  mbid: string,
  opts: { page?: number } = {}
): Promise<SetlistfmSearchResponse> {
  const params = new URLSearchParams({ artistMbid: mbid });
  if (opts.page) params.set("p", String(opts.page));
  return setlistfmGet<SetlistfmSearchResponse>(
    `/search/setlists?${params.toString()}`
  );
}

export async function getSetlist(
  setlistId: string
): Promise<SetlistfmSetlist> {
  return setlistfmGet<SetlistfmSetlist>(
    `/setlist/${encodeURIComponent(setlistId)}`
  );
}

// Setlist.fm sends event dates as "dd-MM-yyyy". Convert to a UTC midnight
// Date so we can compare against our `localDate` column (which is also a
// midnight-anchored Date).
export function parseSetlistfmDate(eventDate: string): Date {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(eventDate);
  if (!m) {
    throw new SetlistfmError(`Invalid eventDate format: ${eventDate}`);
  }
  const [, dd, mm, yyyy] = m;
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
}
