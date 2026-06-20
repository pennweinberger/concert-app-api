// Pure parsers for DICE event data. No I/O.
//
// DICE venue pages emit a `Place` JSON-LD block whose `event[]` array
// contains a `MusicEvent` object per upcoming event. That single block
// is the entire ingestion payload — per-event pages don't expose their
// own MusicEvent JSON-LD, so we don't fetch them.
//
// Per-MusicEvent we extract: providerEventId (from URL), name,
// startDate (ISO with TZ offset), location, image, eventStatus.
// Performer is NOT in JSON-LD — it's encoded in the human-readable
// `name`. We extract a headliner with the heuristic in
// `parseDiceHeadliner` below; misfires route to ProviderMatchReview
// downstream rather than corrupting Show rows.

// ---------------------------------------------------------------------------
// providerEventId extraction
// ---------------------------------------------------------------------------

// DICE event URLs look like:
//   https://dice.fm/event/pyb9mp-themba-th4ys-…-tickets
// The first segment after /event/ is the provider event id.
export function extractDiceEventId(url: string): string | null {
  if (typeof url !== "string") return null;
  const m = /\/event\/([a-z0-9]+)(?:-|$)/i.exec(url);
  return m && m[1] ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Headliner heuristic from event name
// ---------------------------------------------------------------------------

const STRIP_BRACKETS = /\s*\[[^\]]*\]\s*/g;
const STRIP_PARENS = /\s*\([^)]*\)\s*/g;
const LEADING_BRAND_PREFIX = /^([^,:]{1,25}):\s+/;
const PRESENTS_RE = /\s+presents:?\s+/i;
const ROOM_SPLITTER = /\s+\/\s+/;
const BY_SPLITTER = /\s+by\s+/i;
const WITH_SPLITTER = /\s+with\s+/i;

export function parseDiceHeadliner(eventName: string): string {
  if (typeof eventName !== "string") return "";
  const original = eventName.trim();
  if (!original) return "";

  let s = original;

  // 1. Strip bracket and paren annotations: [Live], [UPSTAIRS], (Open
  //    to Close), etc.
  s = s.replace(STRIP_BRACKETS, " ").replace(STRIP_PARENS, " ");
  s = s.replace(/\s+/g, " ").trim();

  // 2. " / " separates rooms or set blocks; take the first.
  if (ROOM_SPLITTER.test(s)) {
    s = s.split(ROOM_SPLITTER)[0]!.trim();
  }

  // 3. "X presents Y" / "X presents: Y" — take the part AFTER presents
  //    (Y is the artist; X is the promoter).
  if (PRESENTS_RE.test(s)) {
    const parts = s.split(PRESENTS_RE);
    s = parts[parts.length - 1]!.trim();
  }

  // 4. "X by Y" — take what comes AFTER the last "by" (Y is the artist
  //    performing X).
  if (BY_SPLITTER.test(s)) {
    const parts = s.split(BY_SPLITTER);
    s = parts[parts.length - 1]!.trim();
  }

  // 5. Leading brand-prefix "Brand: artist list" — only strip if the
  //    prefix is short and contains no comma (so we don't accidentally
  //    strip a long artist list that happens to contain a colon).
  const brand = LEADING_BRAND_PREFIX.exec(s);
  if (brand && brand[1]!.indexOf(",") === -1) {
    s = s.slice(brand[0]!.length).trim();
  }

  // 6. " with " — separates headliner from support; take what's BEFORE.
  if (WITH_SPLITTER.test(s)) {
    s = s.split(WITH_SPLITTER)[0]!.trim();
  }

  // 7. Comma-separated lineup — take the first entry as headliner.
  if (s.includes(",")) {
    s = s.split(",")[0]!.trim();
  }

  s = s.trim();
  // If we stripped everything, fall back to the original (better to
  // have a slightly-wrong headliner than an empty Artist name, which
  // would crash the unique constraint).
  return s || original;
}

// ---------------------------------------------------------------------------
// City extraction from a JSON-LD address string
// ---------------------------------------------------------------------------

// JSON-LD addresses come as freeform strings:
//   "599 Johnson Ave #1, Brooklyn, NY 11237, USA"
//   "233 Butler St, Brooklyn, NY 11217, USA"
//   "52-19 Flushing Ave, Maspeth, NY 11378, USA"
// We trust the seed list's canonical (name, city) over this when
// ingesting — but the parser exposes city extraction for fallback.
export function parseCityFromAddress(address: string): string | null {
  if (typeof address !== "string") return null;
  const parts = address.split(",").map((s) => s.trim());
  // The format is consistently [street, city, state+zip, country] for US
  // addresses. The city is parts[1] if there are ≥3 parts.
  if (parts.length >= 3 && parts[1]) return parts[1];
  return null;
}

// ---------------------------------------------------------------------------
// Place JSON-LD extraction from venue page HTML
// ---------------------------------------------------------------------------

const JSON_LD_RE =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

export type DiceMusicEvent = {
  providerEventId: string;
  url: string;
  name: string;
  startDate: string; // ISO 8601 with TZ offset
  endDate: string | null;
  eventStatus: string | null;
  locationName: string | null;
  locationAddress: string | null;
  imageUrls: string[];
  description: string | null;
};

export type ParsedDiceVenuePage = {
  venueName: string;
  venueAddress: string | null;
  events: DiceMusicEvent[];
};

export function parseDiceVenuePage(html: string): ParsedDiceVenuePage | null {
  if (typeof html !== "string") return null;
  const blocks: unknown[] = [];
  let m: RegExpExecArray | null;
  // Reset lastIndex defensively in case caller reused the regex.
  JSON_LD_RE.lastIndex = 0;
  while ((m = JSON_LD_RE.exec(html)) !== null) {
    const body = m[1];
    if (!body) continue;
    try {
      blocks.push(JSON.parse(body.trim()));
    } catch {
      // Skip malformed blocks rather than failing the whole parse.
    }
  }

  // The block we want is a single object with @type === "Place" and an
  // `event` array. Multiple JSON-LD blocks exist (Brand, WebSite, etc.) —
  // find ours.
  const place = blocks.find(
    (b): b is Record<string, unknown> =>
      typeof b === "object" &&
      b !== null &&
      (b as Record<string, unknown>)["@type"] === "Place",
  );
  if (!place) return null;

  const venueName = typeof place["name"] === "string" ? place["name"] : "";
  const venueAddress =
    typeof place["address"] === "string" ? place["address"] : null;
  const rawEvents = Array.isArray(place["event"])
    ? (place["event"] as unknown[])
    : [];

  const events: DiceMusicEvent[] = [];
  for (const e of rawEvents) {
    if (typeof e !== "object" || e === null) continue;
    const ev = e as Record<string, unknown>;
    if (ev["@type"] !== "MusicEvent") continue;
    const url = typeof ev["url"] === "string" ? ev["url"] : "";
    const providerEventId = extractDiceEventId(url);
    if (!providerEventId) continue;
    const name = typeof ev["name"] === "string" ? ev["name"] : "";
    const startDate = typeof ev["startDate"] === "string" ? ev["startDate"] : "";
    if (!startDate) continue;

    let locationName: string | null = null;
    let locationAddress: string | null = null;
    if (typeof ev["location"] === "object" && ev["location"] !== null) {
      const loc = ev["location"] as Record<string, unknown>;
      if (typeof loc["name"] === "string") locationName = loc["name"];
      if (typeof loc["address"] === "string") locationAddress = loc["address"];
    }

    let imageUrls: string[] = [];
    const img = ev["image"];
    if (typeof img === "string") imageUrls = [img];
    else if (Array.isArray(img))
      imageUrls = img.filter((x): x is string => typeof x === "string");

    events.push({
      providerEventId,
      url,
      name,
      startDate,
      endDate: typeof ev["endDate"] === "string" ? ev["endDate"] : null,
      eventStatus:
        typeof ev["eventStatus"] === "string" ? ev["eventStatus"] : null,
      locationName,
      locationAddress,
      imageUrls,
      description:
        typeof ev["description"] === "string" ? ev["description"] : null,
    });
  }

  return { venueName, venueAddress, events };
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

// startDate from DICE is ISO 8601 with offset (e.g.
// "2026-06-20T22:30:00-04:00"). The canonical Show.localDate column is
// a date-at-midnight value representing the calendar day of the show
// IN THE VENUE'S LOCAL TIMEZONE. We derive that by:
//   1. Parse the ISO timestamp into a Date.
//   2. Extract the local date components from the original string —
//      NOT from the Date object's UTC values — because the venue could
//      be in any timezone and we want THAT timezone's calendar day.
//
// For "2026-06-20T22:30:00-04:00" the local date in -04:00 is
// 2026-06-20, which is what we want. Returning that as a UTC-midnight
// Date for storage in Show.localDate (matching how the rest of the app
// stores localDate).
export function startDateToLocalDateUtcMidnight(startDate: string): Date | null {
  if (typeof startDate !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T/.exec(startDate);
  if (!m) return null;
  const [, y, mm, dd] = m;
  return new Date(`${y}-${mm}-${dd}T00:00:00.000Z`);
}
