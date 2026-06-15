// setlist.fm ingestion orchestrator.
//
// Composes: setlistfm client → DB candidate loads → pure matching
// (providerMatch.ts) → DB writes. The orchestrator itself does the
// candidate queries and the writes; the matching logic stays pure.
//
// Dependency-injection pattern: all I/O comes through `deps` so the
// orchestrator + applyDecision can be unit-tested against a mocked
// Prisma client and a mocked setlist.fm client.

import type { PrismaClient } from "@prisma/client";
import {
  parseSetlistfmDate,
  SetlistfmAuthError,
  SetlistfmRateLimitError,
  type SetlistfmSearchResponse,
  type SetlistfmSetlist,
} from "./setlistfm.js";
import {
  resolveArtist,
  resolveVenue,
  resolveShow,
  decideMatchAction,
  type MatchDecision,
  type ShowResolution,
} from "./providerMatch.js";

const PROVIDER = "setlistfm";

// Synthetic venueId used when venue itself was NEW — guarantees the
// "exact venue match" branch of resolveShow can't fire, while the
// "different venue, same date" branch still does its job.
const UNRESOLVED_VENUE_SENTINEL = "__unresolved_venue__";

const SHOW_DATE_WINDOW_DAYS = 7;

// ---------------------------------------------------------------------------
// Deps + summary types
// ---------------------------------------------------------------------------

export type IngestDeps = {
  prisma: PrismaClient;
  searchSetlistsByArtistMbid: (
    mbid: string,
    opts?: { page?: number }
  ) => Promise<SetlistfmSearchResponse>;
  now: () => Date;
  /** Artists to process per run. Defaults to 20. */
  limit?: number;
};

export type RunSummary = {
  processedArtists: number;
  skippedArtistsNoMbid: number;
  setlistsConsidered: number;
  actions: { AUTO_MERGE: number; CREATE_NEW: number; REVIEW: number };
  errors: number;
  rateLimitedDuringRun: boolean;
  durationMs: number;
};

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

export async function runIngestion(deps: IngestDeps): Promise<RunSummary> {
  const startMs = deps.now().getTime();
  const limit = deps.limit ?? 20;
  const summary: RunSummary = {
    processedArtists: 0,
    skippedArtistsNoMbid: 0,
    setlistsConsidered: 0,
    actions: { AUTO_MERGE: 0, CREATE_NEW: 0, REVIEW: 0 },
    errors: 0,
    rateLimitedDuringRun: false,
    durationMs: 0,
  };

  // Pick the stalest mbid-bearing artists first. Nulls (never fetched)
  // float to the top so brand-new artists are exercised before old ones.
  const artists = await deps.prisma.artist.findMany({
    where: { mbid: { not: null } },
    orderBy: [
      { lastSetlistfmFetchAt: { sort: "asc", nulls: "first" } },
      { id: "asc" },
    ],
    take: limit,
  });

  summary.skippedArtistsNoMbid = await deps.prisma.artist.count({
    where: { mbid: null },
  });

  for (const artist of artists) {
    if (!artist.mbid) continue; // defensive — filter said not null

    try {
      const search = await deps.searchSetlistsByArtistMbid(artist.mbid, {
        page: 1,
      });

      for (const setlist of search.setlist) {
        summary.setlistsConsidered++;
        try {
          const decision = await processSetlist(setlist, deps);
          summary.actions[decision.action]++;
        } catch (e) {
          summary.errors++;
          console.error(
            `setlistfm ingest: failed to process setlist ${setlist.id}`,
            e
          );
        }
      }

      summary.processedArtists++;
      await deps.prisma.artist.update({
        where: { id: artist.id },
        data: { lastSetlistfmFetchAt: deps.now() },
      });
    } catch (e) {
      if (e instanceof SetlistfmRateLimitError) {
        summary.rateLimitedDuringRun = true;
        // Mark this artist's fetch time so we rotate to a different one
        // on the next run, and stop the current run gracefully.
        await deps.prisma.artist.update({
          where: { id: artist.id },
          data: { lastSetlistfmFetchAt: deps.now() },
        });
        break;
      }
      if (e instanceof SetlistfmAuthError) {
        // API key is wrong — surface immediately so Sentry alerts.
        summary.errors++;
        throw e;
      }
      summary.errors++;
      console.error(
        `setlistfm ingest: failed processing artist ${artist.id}`,
        e
      );
    }
  }

  summary.durationMs = deps.now().getTime() - startMs;
  return summary;
}

// ---------------------------------------------------------------------------
// Per-setlist pipeline: load candidates → match → apply
// ---------------------------------------------------------------------------

async function processSetlist(
  payload: SetlistfmSetlist,
  deps: IngestDeps
): Promise<MatchDecision> {
  const localDate = parseSetlistfmDate(payload.eventDate);

  // --- artist candidates ---
  const artistCandidates = await deps.prisma.artist.findMany({
    where: {
      OR: [
        ...(payload.artist.mbid ? [{ mbid: payload.artist.mbid }] : []),
        { name: { contains: payload.artist.name, mode: "insensitive" as const } },
      ],
    },
    take: 50,
  });

  const artistResolution = resolveArtist(
    {
      mbid: payload.artist.mbid ?? undefined,
      name: payload.artist.name,
    },
    artistCandidates.map((a) => ({ id: a.id, name: a.name, mbid: a.mbid }))
  );

  // --- venue candidates ---
  const venueCandidates = await deps.prisma.venue.findMany({
    where: {
      OR: [
        {
          externalRefs: {
            some: {
              provider: PROVIDER,
              providerVenueId: payload.venue.id,
            },
          },
        },
        { city: { equals: payload.venue.city.name, mode: "insensitive" as const } },
      ],
    },
    include: {
      externalRefs: { select: { provider: true, providerVenueId: true } },
    },
    take: 50,
  });

  const venueResolution = resolveVenue(
    {
      id: payload.venue.id,
      name: payload.venue.name,
      city: payload.venue.city.name,
    },
    venueCandidates.map((v) => ({
      id: v.id,
      name: v.name,
      city: v.city,
      externalRefs: v.externalRefs,
    }))
  );

  // --- show candidates ---
  // Only meaningful when artist resolved to a known id. If venue not
  // resolved, we still pass a sentinel so resolveShow can detect
  // "different venue, same date" conflicts.
  let showResolution: ShowResolution = {
    confidence: "NEW",
    showId: null,
    candidateShowIds: [],
    reason: "no_show_match",
  };

  if (artistResolution.artistId) {
    const startWindow = new Date(localDate);
    startWindow.setUTCDate(startWindow.getUTCDate() - SHOW_DATE_WINDOW_DAYS);
    const endWindow = new Date(localDate);
    endWindow.setUTCDate(endWindow.getUTCDate() + SHOW_DATE_WINDOW_DAYS);

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
        venueId: venueResolution.venueId ?? UNRESOLVED_VENUE_SENTINEL,
        localDate,
      },
      showCandidates.map((s) => ({
        id: s.id,
        artistId: s.artistId,
        venueId: s.venueId,
        localDate: s.localDate,
      }))
    );
  }

  const decision = decideMatchAction(artistResolution, venueResolution, showResolution);
  await applyDecision(decision, payload, deps);
  return decision;
}

// ---------------------------------------------------------------------------
// applyDecision — the only place that writes to the DB
// ---------------------------------------------------------------------------

export async function applyDecision(
  decision: MatchDecision,
  payload: SetlistfmSetlist,
  deps: IngestDeps
): Promise<void> {
  const localDate = parseSetlistfmDate(payload.eventDate);
  const now = deps.now();

  if (decision.action === "AUTO_MERGE") {
    // Decision invariant: AUTO_MERGE always has a populated showId.
    if (!decision.showId) {
      throw new Error("applyDecision: AUTO_MERGE without showId");
    }
    const showId = decision.showId;
    await deps.prisma.$transaction([
      deps.prisma.showExternalRef.upsert({
        where: {
          provider_providerEventId: {
            provider: PROVIDER,
            providerEventId: payload.id,
          },
        },
        update: { rawPayload: payload as unknown as object },
        create: {
          showId,
          provider: PROVIDER,
          providerEventId: payload.id,
          rawPayload: payload as unknown as object,
        },
      }),
      deps.prisma.setlistCache.upsert({
        where: { showId },
        update: {
          status: "fetched",
          setlist: (payload.sets ?? null) as unknown as object,
          sourceUrl: payload.url,
          fetchedAt: now,
        },
        create: {
          showId,
          status: "fetched",
          setlist: (payload.sets ?? null) as unknown as object,
          sourceUrl: payload.url,
          fetchedAt: now,
        },
      }),
    ]);
    return;
  }

  if (decision.action === "REVIEW") {
    await deps.prisma.providerMatchReview.upsert({
      where: {
        provider_providerEventId: {
          provider: PROVIDER,
          providerEventId: payload.id,
        },
      },
      update: {
        rawPayload: payload as unknown as object,
        candidateShowIds: decision.candidateShowIds,
        resolvedArtistId: decision.artistId,
        resolvedVenueId: decision.venueId,
        reason: decision.reason,
      },
      create: {
        provider: PROVIDER,
        providerEventId: payload.id,
        rawPayload: payload as unknown as object,
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
  await deps.prisma.$transaction(async (tx) => {
    // 1. Artist (resolved or new)
    let artistId = decision.artistId;
    if (!artistId) {
      const created = await tx.artist.create({
        data: {
          name: payload.artist.name,
          mbid: payload.artist.mbid ?? null,
          // setlist.fm sources mbids from MusicBrainz; high but not 1.0
          // since we haven't independently verified against MB ourselves.
          mbidConfidence: payload.artist.mbid ? 0.95 : null,
        },
      });
      artistId = created.id;
    }

    // 2. Venue (resolved or new)
    let venueId = decision.venueId;
    if (!venueId) {
      const created = await tx.venue.create({
        data: {
          name: payload.venue.name,
          city: payload.venue.city.name,
          country: payload.venue.city.country.code,
        },
      });
      venueId = created.id;
    }

    // 3. Show — idempotent on (artistId, venueId, localDate).
    //    setlist.fm doesn't carry start time so startDatetimeUtc reuses
    //    localDate at UTC midnight.
    const show = await tx.show.upsert({
      where: {
        artistId_venueId_localDate: {
          artistId,
          venueId,
          localDate,
        },
      },
      update: {},
      create: {
        artistId,
        venueId,
        startDatetimeUtc: localDate,
        localDate,
      },
    });

    // 4. ShowExternalRef
    await tx.showExternalRef.upsert({
      where: {
        provider_providerEventId: {
          provider: PROVIDER,
          providerEventId: payload.id,
        },
      },
      update: {
        showId: show.id,
        rawPayload: payload as unknown as object,
      },
      create: {
        showId: show.id,
        provider: PROVIDER,
        providerEventId: payload.id,
        rawPayload: payload as unknown as object,
      },
    });

    // 5. VenueExternalRef — record setlist.fm's venue id ↔ our Venue.
    //    Idempotent; safe to call even when venue was EXACT (ref already
    //    existed) — Prisma upsert just no-ops.
    await tx.venueExternalRef.upsert({
      where: {
        provider_providerVenueId: {
          provider: PROVIDER,
          providerVenueId: payload.venue.id,
        },
      },
      update: { venueId, rawPayload: payload.venue as unknown as object },
      create: {
        venueId,
        provider: PROVIDER,
        providerVenueId: payload.venue.id,
        rawPayload: payload.venue as unknown as object,
      },
    });

    // 6. SetlistCache
    await tx.setlistCache.upsert({
      where: { showId: show.id },
      update: {
        status: "fetched",
        setlist: (payload.sets ?? null) as unknown as object,
        sourceUrl: payload.url,
        fetchedAt: now,
      },
      create: {
        showId: show.id,
        status: "fetched",
        setlist: (payload.sets ?? null) as unknown as object,
        sourceUrl: payload.url,
        fetchedAt: now,
      },
    });
  });
}
