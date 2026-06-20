// DICE ingestion orchestrator.
//
// Per-run flow:
//   for each canonical venue in DICE_NYC_VENUES:
//     for each DICE short id mapped to that canonical:
//       fetch venue page HTML (polite, throttled)
//       parse Place JSON-LD → MusicEvent[]
//       for each event:
//         extract headliner via heuristic
//         resolveArtist + resolveVenue (sibling-room collapse via diceId)
//         resolveShow + decideMatchAction
//         apply decision per user spec:
//           AUTO_MERGE  → upsert ShowExternalRef(provider="dice")
//           CREATE_NEW  → create Show, then ShowExternalRef
//           REVIEW      → upsert ProviderMatchReview row
//     update canonical Venue.lastDiceFetchAt
//
// All I/O comes through `deps` so the orchestrator + applyDiceDecision
// can be unit-tested against a mocked Prisma client and a stubbed
// fetcher.

import type { PrismaClient } from "@prisma/client";
import { DiceDisabledError, DiceRateLimitError } from "./dice.js";
import {
  parseDiceVenuePage,
  parseDiceHeadliner,
  parseCityFromAddress,
  startDateToLocalDateUtcMidnight,
  type DiceMusicEvent,
} from "./diceParse.js";
import {
  resolveArtist as upsertArtist,
  resolveVenue as upsertVenue,
} from "./showResolution.js";
import {
  resolveArtist as matchArtist,
  resolveShow,
  decideMatchAction,
  type MatchDecision,
  type ShowResolution,
} from "./providerMatch.js";
import {
  DICE_NYC_VENUES,
  type DiceSeedVenue,
} from "./diceVenues.js";

const PROVIDER = "dice";

// ---------------------------------------------------------------------------
// Deps + summary types
// ---------------------------------------------------------------------------

export type DiceIngestDeps = {
  prisma: PrismaClient;
  fetchVenuePageHtml: (shortId: string) => Promise<string>;
  now: () => Date;
  /** Optional override for tests; defaults to DICE_NYC_VENUES. */
  seed?: DiceSeedVenue[];
};

export type DiceRunSummary = {
  processedDiceVenues: number;
  eventsConsidered: number;
  actions: { AUTO_MERGE: number; CREATE_NEW: number; REVIEW: number };
  errors: number;
  rateLimitedDuringRun: boolean;
  durationMs: number;
};

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

export async function runDiceIngestion(
  deps: DiceIngestDeps,
): Promise<DiceRunSummary> {
  const startMs = deps.now().getTime();
  const seed = deps.seed ?? DICE_NYC_VENUES;
  const summary: DiceRunSummary = {
    processedDiceVenues: 0,
    eventsConsidered: 0,
    actions: { AUTO_MERGE: 0, CREATE_NEW: 0, REVIEW: 0 },
    errors: 0,
    rateLimitedDuringRun: false,
    durationMs: 0,
  };

  outer: for (const seedVenue of seed) {
    let canonicalVenueId: string | null = null;

    for (const diceShortId of seedVenue.diceShortIds) {
      let html: string;
      try {
        html = await deps.fetchVenuePageHtml(diceShortId);
      } catch (e) {
        if (e instanceof DiceRateLimitError) {
          summary.rateLimitedDuringRun = true;
          break outer; // back off cleanly for this run
        }
        if (e instanceof DiceDisabledError) {
          // Disabled — shouldn't happen if the route guard works, but
          // surface clearly if it does.
          throw e;
        }
        summary.errors++;
        console.error(
          `dice ingest: fetch failed for shortId=${diceShortId}`,
          e,
        );
        continue;
      }

      const parsed = parseDiceVenuePage(html);
      if (!parsed) {
        summary.errors++;
        console.error(
          `dice ingest: no Place JSON-LD on venue page shortId=${diceShortId}`,
        );
        continue;
      }

      for (const event of parsed.events) {
        summary.eventsConsidered++;
        try {
          const decision = await processDiceEvent(
            {
              event,
              diceShortId,
              canonicalVenueName: seedVenue.canonicalName,
              canonicalCity: seedVenue.city,
              fallbackCityFromAddress: parsed.venueAddress
                ? parseCityFromAddress(parsed.venueAddress)
                : null,
            },
            deps,
          );
          summary.actions[decision.action]++;
          // Track canonical Venue id from a successful resolveVenue
          // so we can update lastDiceFetchAt below. Any non-REVIEW
          // decision implies the venue was resolved.
          if (decision.venueId) canonicalVenueId = decision.venueId;
        } catch (e) {
          summary.errors++;
          console.error(
            `dice ingest: failed to process event ${event.providerEventId}`,
            e,
          );
        }
      }
    }

    if (canonicalVenueId) {
      try {
        await deps.prisma.venue.update({
          where: { id: canonicalVenueId },
          data: { lastDiceFetchAt: deps.now() },
        });
      } catch (e) {
        console.error(
          `dice ingest: failed to update lastDiceFetchAt for venue=${canonicalVenueId}`,
          e,
        );
      }
    }
    summary.processedDiceVenues++;
  }

  summary.durationMs = deps.now().getTime() - startMs;
  return summary;
}

// ---------------------------------------------------------------------------
// Per-event pipeline: resolve → decide → apply
// ---------------------------------------------------------------------------

type ProcessInput = {
  event: DiceMusicEvent;
  diceShortId: string;
  canonicalVenueName: string;
  canonicalCity: string;
  fallbackCityFromAddress: string | null;
};

async function processDiceEvent(
  input: ProcessInput,
  deps: DiceIngestDeps,
): Promise<MatchDecision> {
  const { event, diceShortId, canonicalVenueName, canonicalCity } = input;

  // Headliner from the heuristic. Misfires fall through to fuzzy
  // matching downstream which routes to ProviderMatchReview.
  const headlinerName = parseDiceHeadliner(event.name);

  // Local date is the calendar-day-in-venue-timezone, stored as a
  // UTC-midnight Date (matches the existing Show.localDate convention).
  const localDate = startDateToLocalDateUtcMidnight(event.startDate);
  if (!localDate) {
    throw new Error(
      `dice ingest: invalid startDate "${event.startDate}" for event ${event.providerEventId}`,
    );
  }

  // ── Artist resolution (matching-confidence variant) ──────────────
  // Load name-based candidates so providerMatch.resolveArtist can
  // match by name. The confidence variant returns EXACT / PROBABLE /
  // NEEDS_REVIEW / NEW so decideMatchAction can route ambiguous
  // results to ProviderMatchReview.
  const artistCandidates = await deps.prisma.artist.findMany({
    where: {
      name: { contains: headlinerName, mode: "insensitive" as const },
    },
    take: 50,
  });
  const artistResolution = matchArtist(
    { name: headlinerName },
    artistCandidates.map((a) => ({
      id: a.id,
      name: a.name,
      mbid: a.mbid,
    })),
  );

  // ── Venue resolution (upsert + sibling-room collapse via diceId) ─
  // We always know the canonical (name, city) AND the DICE short id,
  // so the upsert variant gives us the canonical Venue row in one
  // call. No confidence ambiguity to model.
  const canonicalVenueRow = await upsertVenue(
    {
      name: canonicalVenueName,
      city: canonicalCity,
      diceId: diceShortId,
    },
    { prisma: deps.prisma },
  );

  // For the matching layer's resolveVenue (confidence-based), we
  // simulate "venue is EXACT because we just looked it up by id":
  // matchResolveVenue isn't actually needed because we already KNOW
  // the canonical venue. So we synthesize a resolution.
  const venueResolution = {
    confidence: "EXACT" as const,
    venueId: canonicalVenueRow.id,
    reason: "dice_external_ref_match",
  };

  // ── Show resolution ──────────────────────────────────────────────
  let showResolution: ShowResolution = {
    confidence: "NEW",
    showId: null,
    candidateShowIds: [],
    reason: "no_show_match",
  };

  // Only run show resolution if artist resolved to a known id
  // (otherwise we'd need a new Artist row first; decideMatchAction
  // will handle that via CREATE_NEW path).
  if (artistResolution.artistId) {
    const startWindow = new Date(localDate);
    startWindow.setUTCDate(startWindow.getUTCDate() - 7);
    const endWindow = new Date(localDate);
    endWindow.setUTCDate(endWindow.getUTCDate() + 7);

    const showCandidates = await deps.prisma.show.findMany({
      where: {
        artistId: artistResolution.artistId,
        localDate: { gte: startWindow, lte: endWindow },
      },
      take: 50,
    });
    showResolution = resolveShow(
      {
        artistId: artistResolution.artistId,
        venueId: canonicalVenueRow.id,
        localDate,
      },
      showCandidates.map((s) => ({
        id: s.id,
        artistId: s.artistId,
        venueId: s.venueId,
        localDate: s.localDate,
      })),
    );
  }

  const decision = decideMatchAction(
    artistResolution,
    venueResolution,
    showResolution,
  );

  // For the apply step, the canonical artist might still need to be
  // materialized. The matching variant returns artistId=null for
  // NEW; we need to actually create the Artist row via the upsert
  // variant before AUTO_MERGE or CREATE_NEW can write a ShowExternalRef.
  let resolvedArtistId = decision.artistId;
  if (decision.action !== "REVIEW" && !resolvedArtistId) {
    const created = await upsertArtist(
      { name: headlinerName },
      { prisma: deps.prisma },
    );
    resolvedArtistId = created.id;
  }

  await applyDiceDecision(
    {
      decision: { ...decision, artistId: resolvedArtistId },
      event,
      localDate,
      canonicalVenueId: canonicalVenueRow.id,
      diceShortId,
    },
    deps,
  );
  return decision;
}

// ---------------------------------------------------------------------------
// applyDiceDecision — the only place that writes to the DB
// ---------------------------------------------------------------------------

export type ApplyDiceDecisionInput = {
  decision: MatchDecision;
  event: DiceMusicEvent;
  localDate: Date;
  canonicalVenueId: string;
  diceShortId: string;
};

export async function applyDiceDecision(
  input: ApplyDiceDecisionInput,
  deps: { prisma: PrismaClient; now: () => Date },
): Promise<void> {
  const { decision, event, localDate, canonicalVenueId } = input;
  const now = deps.now();

  if (decision.action === "AUTO_MERGE") {
    if (!decision.showId) {
      throw new Error("applyDiceDecision: AUTO_MERGE without showId");
    }
    await deps.prisma.showExternalRef.upsert({
      where: {
        provider_providerEventId: {
          provider: PROVIDER,
          providerEventId: event.providerEventId,
        },
      },
      update: { rawPayload: event as unknown as object },
      create: {
        showId: decision.showId,
        provider: PROVIDER,
        providerEventId: event.providerEventId,
        rawPayload: event as unknown as object,
      },
    });
    return;
  }

  if (decision.action === "REVIEW") {
    await deps.prisma.providerMatchReview.upsert({
      where: {
        provider_providerEventId: {
          provider: PROVIDER,
          providerEventId: event.providerEventId,
        },
      },
      update: {
        rawPayload: event as unknown as object,
        candidateShowIds: decision.candidateShowIds,
        resolvedArtistId: decision.artistId,
        resolvedVenueId: decision.venueId,
        reason: decision.reason,
      },
      create: {
        provider: PROVIDER,
        providerEventId: event.providerEventId,
        rawPayload: event as unknown as object,
        candidateShowIds: decision.candidateShowIds,
        resolvedArtistId: decision.artistId,
        resolvedVenueId: decision.venueId,
        reason: decision.reason,
        status: "pending",
      },
    });
    return;
  }

  // CREATE_NEW
  if (!decision.artistId) {
    throw new Error("applyDiceDecision: CREATE_NEW without resolved artistId");
  }
  if (decision.venueId !== canonicalVenueId) {
    // Defensive: the orchestrator always passes a known canonical
    // venue. If decision.venueId disagrees, something is wrong.
    throw new Error(
      `applyDiceDecision: CREATE_NEW venueId mismatch (decision=${decision.venueId} canonical=${canonicalVenueId})`,
    );
  }

  await deps.prisma.$transaction(async (tx) => {
    const show = await tx.show.upsert({
      where: {
        artistId_venueId_localDate: {
          artistId: decision.artistId!,
          venueId: canonicalVenueId,
          localDate,
        },
      },
      update: {},
      create: {
        artistId: decision.artistId!,
        venueId: canonicalVenueId,
        startDatetimeUtc: new Date(event.startDate),
        localDate,
      },
    });

    await tx.showExternalRef.upsert({
      where: {
        provider_providerEventId: {
          provider: PROVIDER,
          providerEventId: event.providerEventId,
        },
      },
      update: {
        showId: show.id,
        rawPayload: event as unknown as object,
      },
      create: {
        showId: show.id,
        provider: PROVIDER,
        providerEventId: event.providerEventId,
        rawPayload: event as unknown as object,
      },
    });
  });

  // Suppress unused-now warning; reserved for future timestamps if
  // we later track ingestion runs per row.
  void now;
}
