// The seam between "some upstream provider" and "Afterset's database".
//
// Every ingestion source — Ticketmaster today, AXS next, eventually DICE
// and Bowery — normalises its own feed into NormalizedEvent[] and hands
// them to ingestEngine. Nothing downstream of this file knows which
// provider produced an event, which is what keeps adding a source to a
// parser rather than a rewrite.
//
// KNOWN DEBT — one artist per show.
// `Show` is keyed `@@unique([artistId, venueId, localDate])`, so a
// co-headline bill or a festival day currently becomes N separate Show
// rows, one per artist, all pointing at the same real-world night. That
// is wrong and will need a Show↔Artist join table (a lineup, with a
// headliner flag) to fix properly.
//
// This type is deliberately shaped so that change stays possible: a
// NormalizedEvent carries ONE artist because that is what the current
// schema can express, but nothing in the engine assumes the mapping is
// one-to-one forever. When the join table lands, `artist` becomes
// `artists: [...]` and the engine's resolution step changes; parsers and
// callers are unaffected.

/** Provider-reported lifecycle for a show. */
export type ShowStatus =
  | "scheduled"
  | "cancelled"
  | "postponed"
  | "rescheduled";

export type NormalizedEvent = {
  /** Stable provider slug, e.g. "ticketmaster". Used as the ref key. */
  provider: string;
  /** The provider's own id for this event. Unique within the provider. */
  providerEventId: string;

  artist: {
    name: string;
    /** The provider's id for the artist, when it publishes one. */
    providerId?: string | null;
  };

  venue: {
    name: string;
    city: string;
    state?: string | null;
    country?: string | null;
    providerId?: string | null;
    timezone?: string | null;
  };

  /** Exact UTC start, when the provider gives a time. */
  startDatetimeUtc: Date | null;
  /** UTC-midnight of the LOCAL calendar date. Part of the Show key. */
  localDate: Date;
  timezone?: string | null;

  status: ShowStatus;

  /** Original provider payload, stored on the ref row for debugging. */
  raw?: unknown;
};

export type IngestSkipReason =
  | "duplicateInBatch"
  | "missingArtist"
  | "missingVenue"
  | "invalidDate"
  | "unchanged"
  | "writeBudgetReached";

export type IngestSummary = {
  provider: string;
  /** Events handed to the engine (post-fetch, pre-validation). */
  fetched: number;
  /** New Show rows created. */
  created: number;
  /** Existing Show matched and linked to this provider for the first time. */
  matched: number;
  /** Existing Show whose provider-owned metadata or status changed. */
  updated: number;
  skipped: Record<IngestSkipReason, number>;
  /** Rows queued in ProviderMatchReview for a human to merge. */
  needsReview: number;
  errors: number;
  /** Set when the run stopped early on the write budget. */
  budgetExhausted?: boolean;
};

export function freshSummary(provider: string): IngestSummary {
  return {
    provider,
    fetched: 0,
    created: 0,
    matched: 0,
    updated: 0,
    skipped: {
      duplicateInBatch: 0,
      missingArtist: 0,
      missingVenue: 0,
      invalidDate: 0,
      unchanged: 0,
      writeBudgetReached: 0,
    },
    needsReview: 0,
    errors: 0,
  };
}

/**
 * Collapse the whitespace and casing noise that upstream feeds carry.
 * Observed live in the Ticketmaster feed: the city "Brooklyn " with a
 * trailing space, sitting alongside "Brooklyn". Since Venue is unique on
 * (name, city), passing that through would silently create a duplicate
 * venue and split one room's shows across two pages.
 */
export function normalizeText(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}
