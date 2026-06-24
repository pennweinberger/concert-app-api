// Bowery feed parsers. Pure functions, no I/O.
//
// Source shape: AEG's regional JSON blob (~1000 events) with a top-level
// { meta, events: [...] }. Each event is rich (headliners with HTML +
// plain-text variants, full venue address, ticketing status, several
// timestamps with timezone info). We extract a minimal normalized shape
// for the orchestrator and the rest goes into rawPayload for forensics.

export class BowerySchemaDriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BowerySchemaDriftError";
  }
}

// ---------------------------------------------------------------------------
// Types — the FIELDS we actually use; everything else stays in rawPayload
// ---------------------------------------------------------------------------

export type BoweryVenue = {
  venueId: string;
  title: string;
  city: string;
  state: string;
  address_line: string | null;
  timezone: string | null;
};

export type BoweryTicketing = {
  status: string | null;
  statusId: number | null;
  ticketURL: string | null;
  url: string | null;
  eventUrl: string | null;
};

export type BoweryTitle = {
  headlinersText: string;
  supportingText: string | null;
  tour: string | null;
  eventTitleText: string | null;
};

export type BoweryEvent = {
  eventId: string;
  eventDateTimeISO: string;
  title: BoweryTitle;
  venue: BoweryVenue;
  ticketing: BoweryTicketing;
  active: boolean;
  publishStatus: number;
  private: boolean;
  /** Original unmodified event object — preserved for ShowExternalRef.rawPayload. */
  raw: Record<string, unknown>;
};

export type ParsedBoweryFeed = {
  totalReported: number;
  events: BoweryEvent[];
};

// ---------------------------------------------------------------------------
// parseBoweryFeed — validates the top-level shape, picks fields we need
// ---------------------------------------------------------------------------

export function parseBoweryFeed(raw: unknown): ParsedBoweryFeed {
  if (!raw || typeof raw !== "object") {
    throw new BowerySchemaDriftError("Feed root is not an object");
  }
  const root = raw as Record<string, unknown>;
  const meta = root["meta"];
  const totalReported =
    meta &&
    typeof meta === "object" &&
    typeof (meta as Record<string, unknown>)["total"] === "number"
      ? ((meta as Record<string, unknown>)["total"] as number)
      : 0;

  const rawEvents = root["events"];
  if (!Array.isArray(rawEvents)) {
    throw new BowerySchemaDriftError("Feed.events is not an array");
  }

  const events: BoweryEvent[] = [];
  for (const rawEv of rawEvents) {
    const e = pickEvent(rawEv);
    if (e) events.push(e);
    // Silently skip events whose REQUIRED fields are missing — these
    // are unusable (no id or no date), not schema drift. Tracking those
    // is the orchestrator's job (it can compare totalReported to
    // events.length to log a delta if it ever spikes).
  }

  return { totalReported, events };
}

function pickEvent(raw: unknown): BoweryEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const eventId = stringOrNull(r["eventId"]);
  const eventDateTimeISO = stringOrNull(r["eventDateTimeISO"]);
  if (!eventId || !eventDateTimeISO) return null;

  const title = pickTitle(r["title"]);
  const venue = pickVenue(r["venue"]);
  if (!title || !venue) return null;

  const ticketing = pickTicketing(r["ticketing"]);

  return {
    eventId,
    eventDateTimeISO,
    title,
    venue,
    ticketing,
    // Defensive defaults: missing booleans treated as "active enough to
    // consider". The skip rule explicitly checks for false / 0 / true.
    active: r["active"] === false ? false : true,
    publishStatus:
      typeof r["publishStatus"] === "number" ? (r["publishStatus"] as number) : 1,
    private: r["private"] === true,
    raw: r,
  };
}

function pickTitle(raw: unknown): BoweryTitle | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const headlinersText = stringOrNull(t["headlinersText"]);
  if (!headlinersText) return null;
  return {
    headlinersText,
    supportingText: stringOrNull(t["supportingText"]),
    tour: stringOrNull(t["tour"]),
    eventTitleText: stringOrNull(t["eventTitleText"]),
  };
}

function pickVenue(raw: unknown): BoweryVenue | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const venueId = stringOrNull(v["venueId"]);
  const title = stringOrNull(v["title"]);
  const city = stringOrNull(v["city"]);
  const state = stringOrNull(v["state"]);
  if (!venueId || !title || !city || !state) return null;
  return {
    venueId,
    title,
    city,
    state,
    address_line: stringOrNull(v["address_line"]),
    timezone: stringOrNull(v["timezone"]),
  };
}

function pickTicketing(raw: unknown): BoweryTicketing {
  if (!raw || typeof raw !== "object") {
    return { status: null, statusId: null, ticketURL: null, url: null, eventUrl: null };
  }
  const t = raw as Record<string, unknown>;
  return {
    status: stringOrNull(t["status"]),
    statusId: typeof t["statusId"] === "number" ? (t["statusId"] as number) : null,
    ticketURL: stringOrNull(t["ticketURL"]),
    url: stringOrNull(t["url"]),
    eventUrl: stringOrNull(t["eventUrl"]),
  };
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

// ---------------------------------------------------------------------------
// Skip rule — cancelled / postponed / inactive / unpublished / private
// ---------------------------------------------------------------------------

// Observed status set in the live feed (2026-06-24): "Buy Tickets" (922),
// "Coming Soon" (64), "Get Tickets" (11), "Cancelled" (8), "Sold Out" (5),
// "Postponed" (5), "Free" (1). v1 skips Cancelled + Postponed; everything
// else is treated as a real upcoming show.
const SKIP_STATUS_NORMALIZED: ReadonlySet<string> = new Set([
  "cancelled",
  "canceled",
  "postponed",
]);

export type SkipReason =
  | "cancelled"
  | "postponed"
  | "inactive"
  | "unpublished"
  | "private";

export function eventSkipReason(event: BoweryEvent): SkipReason | null {
  if (!event.active) return "inactive";
  if (event.publishStatus === 0) return "unpublished";
  if (event.private) return "private";
  const status = (event.ticketing.status ?? "").toLowerCase().trim();
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "postponed") return "postponed";
  // Defensive: future-proof against new "bad" statuses by checking the
  // normalized set too (currently equivalent to the two checks above,
  // but kept for clarity if we expand later).
  if (SKIP_STATUS_NORMALIZED.has(status)) return "cancelled";
  return null;
}

// ---------------------------------------------------------------------------
// Date helper — same convention as DICE (UTC-midnight Date representing
// the calendar day in the venue's local timezone).
// ---------------------------------------------------------------------------

export function startDateToLocalDateUtcMidnight(iso: string): Date | null {
  if (typeof iso !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T/.exec(iso);
  if (!m) return null;
  const [, y, mm, dd] = m;
  return new Date(`${y}-${mm}-${dd}T00:00:00.000Z`);
}
