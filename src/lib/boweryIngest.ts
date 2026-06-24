// Bowery / AEG ingestion orchestrator.
//
// Per-run flow (single HTTP fetch — much simpler than DICE):
//   1. Fetch the feed (one HTTPS GET).
//   2. Parse feed → validate top-level shape.
//   3. For each event:
//      - filter: venue not in allowlist → skip
//      - filter: venue.state !== "NY" → skip (defense in depth)
//      - filter: cancelled / postponed / inactive / unpublished / private → skip
//      - resolve artist (matching variant for confidence)
//      - resolve venue (Bowery external ref → falls back to name+city upsert)
//      - resolve show
//      - decideMatchAction → AUTO_MERGE / CREATE_NEW / REVIEW
//      - applyBoweryDecision writes ShowExternalRef / Show /
//        ProviderMatchReview rows
//
// All I/O comes through `deps` so the orchestrator is unit-testable
// against a mocked Prisma client and a stubbed feed fetcher.

import type { PrismaClient } from "@prisma/client";
import * as Sentry from "@sentry/node";
import {
  BoweryDisabledError,
  BoweryFetchError,
  type BoweryFeedResponse,
} from "./bowery.js";
import {
  parseBoweryFeed,
  startDateToLocalDateUtcMidnight,
  eventSkipReason,
  BowerySchemaDriftError,
  type BoweryEvent,
  type SkipReason,
} from "./boweryParse.js";
import { isAllowlistedVenueId } from "./boweryVenues.js";
import { resolveArtist as upsertArtist } from "./showResolution.js";
import {
  resolveArtist as matchArtist,
  resolveShow,
  decideMatchAction,
  type MatchDecision,
  type ShowResolution,
} from "./providerMatch.js";

const PROVIDER = "bowery";

// ---------------------------------------------------------------------------
// Deps + summary types
// ---------------------------------------------------------------------------

export type BoweryIngestDeps = {
  prisma: PrismaClient;
  fetchBoweryFeed: () => Promise<BoweryFeedResponse>;
  now: () => Date;
  /** When true, parse + filter but skip every DB write. */
  dryRun?: boolean;
};

export type BoweryRunSummary = {
  feedTotalReported: number;
  feedEventsParsed: number;
  allowlistMatched: number;
  skippedNonAllowlistVenue: number;
  skippedNonNyState: number;
  skippedInactive: { total: number; byReason: Record<SkipReason, number> };
  eventsProcessed: number;
  actions: { AUTO_MERGE: number; CREATE_NEW: number; REVIEW: number };
  errors: number;
  dryRun: boolean;
  feedEtag: string | null;
  feedLastModified: string | null;
  durationMs: number;
};

function freshSummary(): BoweryRunSummary {
  return {
    feedTotalReported: 0,
    feedEventsParsed: 0,
    allowlistMatched: 0,
    skippedNonAllowlistVenue: 0,
    skippedNonNyState: 0,
    skippedInactive: {
      total: 0,
      byReason: {
        cancelled: 0,
        postponed: 0,
        inactive: 0,
        unpublished: 0,
        private: 0,
      },
    },
    eventsProcessed: 0,
    actions: { AUTO_MERGE: 0, CREATE_NEW: 0, REVIEW: 0 },
    errors: 0,
    dryRun: false,
    feedEtag: null,
    feedLastModified: null,
    durationMs: 0,
  };
}

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

export async function runBoweryIngestion(
  deps: BoweryIngestDeps,
): Promise<BoweryRunSummary> {
  const startMs = deps.now().getTime();
  const summary = freshSummary();
  summary.dryRun = !!deps.dryRun;

  // 1. Fetch the feed.
  let feedResp: BoweryFeedResponse;
  try {
    feedResp = await deps.fetchBoweryFeed();
  } catch (e) {
    if (e instanceof BoweryDisabledError) {
      // Should be caught by the route guard before getting here, but
      // surface clearly if the guard was bypassed.
      throw e;
    }
    if (e instanceof BoweryFetchError) {
      Sentry.captureException(e);
      throw e;
    }
    Sentry.captureException(e);
    throw e;
  }
  summary.feedEtag = feedResp.etag;
  summary.feedLastModified = feedResp.lastModified;

  // 2. Parse the feed. Schema drift here is a hard failure surfaced to
  //    Sentry — we don't want to silently process garbage.
  let parsed;
  try {
    parsed = parseBoweryFeed(feedResp.rawJson);
  } catch (e) {
    if (e instanceof BowerySchemaDriftError) {
      Sentry.captureException(e);
    }
    throw e;
  }
  summary.feedTotalReported = parsed.totalReported;
  summary.feedEventsParsed = parsed.events.length;

  // 3. Per-event pipeline.
  for (const ev of parsed.events) {
    // Allowlist filter — by venueId (the primary key for venue identity
    // in the feed). Non-allowlist events are silently dropped; their
    // count is summarized.
    if (!isAllowlistedVenueId(ev.venue.venueId)) {
      summary.skippedNonAllowlistVenue++;
      continue;
    }
    summary.allowlistMatched++;

    // Defense in depth: an allowlisted venue should always be NY.
    if (ev.venue.state !== "NY") {
      summary.skippedNonNyState++;
      continue;
    }

    // Cancelled / postponed / inactive / unpublished / private.
    const skip = eventSkipReason(ev);
    if (skip) {
      summary.skippedInactive.total++;
      summary.skippedInactive.byReason[skip]++;
      continue;
    }

    summary.eventsProcessed++;

    if (deps.dryRun) continue;

    try {
      const decision = await processBoweryEvent(ev, deps);
      summary.actions[decision.action]++;
    } catch (e) {
      summary.errors++;
      console.error(
        `bowery ingest: failed to process event ${ev.eventId}`,
        e,
      );
      Sentry.captureException(e, {
        tags: { provider: "bowery", eventId: ev.eventId },
      });
    }
  }

  summary.durationMs = deps.now().getTime() - startMs;
  return summary;
}

// ---------------------------------------------------------------------------
// Per-event pipeline: resolve → decide → apply
// ---------------------------------------------------------------------------

async function processBoweryEvent(
  event: BoweryEvent,
  deps: BoweryIngestDeps,
): Promise<MatchDecision> {
  // ── Headliner is already a plain string in the feed (headlinersText
  // strips the HTML anchor that wraps it elsewhere). For multi-act
  // listings we may need separator handling later, but every observed
  // value so far is a single artist name.
  const headlinerName = event.title.headlinersText.trim();
  if (!headlinerName) {
    throw new Error(`bowery: empty headlinersText for event ${event.eventId}`);
  }

  const localDate = startDateToLocalDateUtcMidnight(event.eventDateTimeISO);
  if (!localDate) {
    throw new Error(
      `bowery: invalid eventDateTimeISO "${event.eventDateTimeISO}" for event ${event.eventId}`,
    );
  }

  // ── Artist resolution (confidence variant).
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

  // ── Venue resolution — Bowery-specific via VenueExternalRef, falling
  // back to (name, city) upsert. We don't extend showResolution.ts for
  // v1 to keep the change surface tight.
  const canonicalVenue = await resolveBoweryVenue(event, deps.prisma);

  const venueResolution = {
    confidence: "EXACT" as const,
    venueId: canonicalVenue.id,
    reason: "bowery_external_ref_match",
  };

  // ── Show resolution.
  let showResolution: ShowResolution = {
    confidence: "NEW",
    showId: null,
    candidateShowIds: [],
    reason: "no_show_match",
  };

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
        venueId: canonicalVenue.id,
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

  // For non-REVIEW outcomes, materialize the canonical Artist row if
  // one wasn't already matched (mirror DICE).
  let resolvedArtistId = decision.artistId;
  if (decision.action !== "REVIEW" && !resolvedArtistId) {
    const created = await upsertArtist(
      { name: headlinerName },
      { prisma: deps.prisma },
    );
    resolvedArtistId = created.id;
  }

  await applyBoweryDecision(
    {
      decision: { ...decision, artistId: resolvedArtistId },
      event,
      localDate,
      canonicalVenueId: canonicalVenue.id,
    },
    deps,
  );
  return decision;
}

async function resolveBoweryVenue(
  event: BoweryEvent,
  prisma: PrismaClient,
): Promise<{ id: string; name: string; city: string }> {
  // 1. Try VenueExternalRef by (provider="bowery", venueId).
  const ref = await prisma.venueExternalRef.findUnique({
    where: {
      provider_providerVenueId: {
        provider: PROVIDER,
        providerVenueId: event.venue.venueId,
      },
    },
    include: {
      venue: { select: { id: true, name: true, city: true } },
    },
  });
  if (ref?.venue) return ref.venue;

  // 2. Upsert by (name, city) using the feed's values directly.
  const venue = await prisma.venue.upsert({
    where: { name_city: { name: event.venue.title, city: event.venue.city } },
    update: {},
    create: { name: event.venue.title, city: event.venue.city },
    select: { id: true, name: true, city: true },
  });

  // 3. Stamp the bowery external ref so step 1 hits next time.
  await prisma.venueExternalRef.upsert({
    where: {
      provider_providerVenueId: {
        provider: PROVIDER,
        providerVenueId: event.venue.venueId,
      },
    },
    update: { venueId: venue.id },
    create: {
      provider: PROVIDER,
      providerVenueId: event.venue.venueId,
      venueId: venue.id,
    },
  });
  return venue;
}

// ---------------------------------------------------------------------------
// applyBoweryDecision — the only place that writes Show / ShowExternalRef /
// ProviderMatchReview. Mirrors applyDiceDecision exactly with provider swap.
// ---------------------------------------------------------------------------

export type ApplyBoweryDecisionInput = {
  decision: MatchDecision;
  event: BoweryEvent;
  localDate: Date;
  canonicalVenueId: string;
};

export async function applyBoweryDecision(
  input: ApplyBoweryDecisionInput,
  deps: { prisma: PrismaClient; now: () => Date },
): Promise<void> {
  const { decision, event, localDate, canonicalVenueId } = input;
  const now = deps.now();

  if (decision.action === "AUTO_MERGE") {
    if (!decision.showId) {
      throw new Error("applyBoweryDecision: AUTO_MERGE without showId");
    }
    await deps.prisma.showExternalRef.upsert({
      where: {
        provider_providerEventId: {
          provider: PROVIDER,
          providerEventId: event.eventId,
        },
      },
      update: { rawPayload: event.raw as unknown as object },
      create: {
        showId: decision.showId,
        provider: PROVIDER,
        providerEventId: event.eventId,
        rawPayload: event.raw as unknown as object,
      },
    });
    return;
  }

  if (decision.action === "REVIEW") {
    await deps.prisma.providerMatchReview.upsert({
      where: {
        provider_providerEventId: {
          provider: PROVIDER,
          providerEventId: event.eventId,
        },
      },
      update: {
        rawPayload: event.raw as unknown as object,
        candidateShowIds: decision.candidateShowIds,
        resolvedArtistId: decision.artistId,
        resolvedVenueId: decision.venueId,
        reason: decision.reason,
      },
      create: {
        provider: PROVIDER,
        providerEventId: event.eventId,
        rawPayload: event.raw as unknown as object,
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
    throw new Error("applyBoweryDecision: CREATE_NEW without resolved artistId");
  }
  if (decision.venueId !== canonicalVenueId) {
    throw new Error(
      `applyBoweryDecision: CREATE_NEW venueId mismatch (decision=${decision.venueId} canonical=${canonicalVenueId})`,
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
        startDatetimeUtc: new Date(event.eventDateTimeISO),
        localDate,
      },
    });

    await tx.showExternalRef.upsert({
      where: {
        provider_providerEventId: {
          provider: PROVIDER,
          providerEventId: event.eventId,
        },
      },
      update: {
        showId: show.id,
        rawPayload: event.raw as unknown as object,
      },
      create: {
        showId: show.id,
        provider: PROVIDER,
        providerEventId: event.eventId,
        rawPayload: event.raw as unknown as object,
      },
    });
  });

  void now;
}
