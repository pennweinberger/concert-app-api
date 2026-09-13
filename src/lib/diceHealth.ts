// DICE ingestion health checks.
//
// Why this exists: in September 2026 DICE changed its venue-page JSON-LD
// (events became "@type": "Event", no longer "MusicEvent"). The parser
// quietly accepted none of them. For days every run reported success
// with eventsConsidered: 0 — errors: 0, nothing in Sentry, nothing
// anywhere. A run that ingests nothing because the parser no longer
// understands the page must not be indistinguishable from a quiet week.
//
// Deliberately separate from diceParse.ts. This module only OBSERVES the
// page; it never decides which events are accepted, so the parser's
// behaviour stays exactly as it is.
//
// Two rules, each aimed at a failure mode that is otherwise silent:
//
//   parser_drift
//     A venue page lists events in its Place JSON-LD, yet the parser
//     accepted zero of them. This is the precise signature of a markup
//     change. It cannot be caused by a venue genuinely having no shows,
//     because then the page lists nothing.
//
//   zero_events_from_active_venues
//     At least MIN_ACTIVE_VENUES_FOR_ZERO_YIELD_ALERT venues that we know
//     are active (they have upcoming DICE-linked shows in our database)
//     produced zero events this run — for any reason: fetch failure, no
//     Place block, an empty event list, or everything rejected. This
//     catches breakages parser_drift cannot see, such as the event list
//     disappearing entirely.
//
// A single empty venue is NOT an alert. Several of the 19 venues have
// quiet stretches with nothing upcoming, and alerting on each one would
// train everyone to ignore the alarm.

const JSON_LD_RE =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** Alert only when at least this many known-active venues go quiet at once. */
export const MIN_ACTIVE_VENUES_FOR_ZERO_YIELD_ALERT = 2;

export type DiceVenuePageStats = {
  /** A Place JSON-LD block was present. */
  placeFound: boolean;
  /** Entries in Place.event, before any filtering by the parser. */
  rawEventCount: number;
  /** Distinct @type values across those entries, e.g. ["Event"]. */
  rawEventTypes: string[];
};

/**
 * Count what the page offers, independently of what the parser accepts.
 * Comparing the two is what exposes drift.
 */
export function inspectDiceVenuePage(html: string): DiceVenuePageStats {
  const empty: DiceVenuePageStats = {
    placeFound: false,
    rawEventCount: 0,
    rawEventTypes: [],
  };
  if (typeof html !== "string") return empty;

  JSON_LD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JSON_LD_RE.exec(html)) !== null) {
    let block: unknown;
    try {
      block = JSON.parse((m[1] ?? "").trim());
    } catch {
      continue;
    }
    if (
      typeof block !== "object" ||
      block === null ||
      (block as Record<string, unknown>)["@type"] !== "Place"
    ) {
      continue;
    }
    const rawEvents = (block as Record<string, unknown>)["event"];
    const events = Array.isArray(rawEvents)
      ? rawEvents.filter((e) => typeof e === "object" && e !== null)
      : [];
    const types = new Set<string>();
    for (const e of events) {
      const t = (e as Record<string, unknown>)["@type"];
      if (typeof t === "string") types.add(t);
      else if (Array.isArray(t)) {
        const joined = t.filter((x) => typeof x === "string").join("|");
        if (joined) types.add(joined);
      }
    }
    return {
      placeFound: true,
      rawEventCount: events.length,
      rawEventTypes: [...types].sort(),
    };
  }
  return empty;
}

export type DiceDriftPage = {
  diceShortId: string;
  rawEventCount: number;
  rawEventTypes: string[];
};

export type DiceRunHealthReason =
  | "parser_drift"
  | "zero_events_from_active_venues";

export type DiceRunHealth = {
  status: "healthy" | "unhealthy";
  reasons: DiceRunHealthReason[];
};

export function evaluateDiceRunHealth(input: {
  driftPages: DiceDriftPage[];
  activeVenuesWithZeroEvents: string[];
}): DiceRunHealth {
  const reasons: DiceRunHealthReason[] = [];
  if (input.driftPages.length > 0) reasons.push("parser_drift");
  if (
    input.activeVenuesWithZeroEvents.length >=
    MIN_ACTIVE_VENUES_FOR_ZERO_YIELD_ALERT
  ) {
    reasons.push("zero_events_from_active_venues");
  }
  return { status: reasons.length ? "unhealthy" : "healthy", reasons };
}

type SummaryWithHealth = {
  health: DiceRunHealth;
  driftPages: DiceDriftPage[];
  activeVenuesWithZeroEvents: string[];
};

/**
 * Thrown AFTER a run has finished its work, so everything it could do is
 * already written. It carries the full run summary: withIngestRun persists
 * `summary` from a thrown error, so the counts that explain the failure
 * are not lost the way they would be with a plain Error.
 */
export class DiceIngestHealthError<
  S extends SummaryWithHealth = SummaryWithHealth,
> extends Error {
  readonly reasons: DiceRunHealthReason[];
  readonly summary: S;

  constructor(summary: S) {
    const parts: string[] = [];
    if (summary.health.reasons.includes("parser_drift")) {
      const pages = summary.driftPages
        .map(
          (p) =>
            `${p.diceShortId} listed ${p.rawEventCount} (types: ${p.rawEventTypes.join(", ") || "none"})`,
        )
        .join("; ");
      parts.push(`parser_drift: pages listed events but 0 were accepted [${pages}]`);
    }
    if (summary.health.reasons.includes("zero_events_from_active_venues")) {
      parts.push(
        `zero_events_from_active_venues: ${summary.activeVenuesWithZeroEvents.length} venues with upcoming DICE shows returned 0 events [${summary.activeVenuesWithZeroEvents.join(", ")}]`,
      );
    }
    super(`DICE ingestion unhealthy — ${parts.join(" | ")}`);
    this.name = "DiceIngestHealthError";
    this.reasons = [...summary.health.reasons];
    this.summary = summary;
  }
}

/** Turn an unhealthy summary into a failure. A healthy one passes through. */
export function assertDiceRunHealthy<S extends SummaryWithHealth>(summary: S): S {
  if (summary.health.status === "unhealthy") {
    throw new DiceIngestHealthError(summary);
  }
  return summary;
}
