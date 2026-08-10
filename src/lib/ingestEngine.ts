// Shared ingestion engine — provider-neutral.
//
// Takes NormalizedEvent[] from any adapter and reconciles them into
// Artist / Venue / Show / ShowExternalRef. All provider-specific
// knowledge stops at the parser; this file only ever sees the neutral
// shape, which is why a new source costs a parser and nothing else.
//
// TWO RULES THAT ARE NOT NEGOTIABLE:
//
//   1. Nothing is ever deleted. A show that disappears from a feed stays
//      exactly as it is. Providers drop events once they have happened —
//      Ticketmaster purges them roughly a day after the date — so absence
//      carries no information at all. Only an EXPLICIT provider status
//      ("cancelled") changes Show.status.
//
//   2. Provider data never overwrites Afterset data. Reviews, attendances
//      and comments are untouched by definition (different tables), and
//      the engine only fills NULL fields or updates provider-owned ones
//      (start time, status). It never renames an Artist or Venue.
//
// PERFORMANCE: DATABASE_URL pins connection_limit=1, so Prisma queries
// serialise on a single connection and latency tracks query COUNT, not
// concurrency. Two consequences shape this file: the idempotency check is
// ONE batched findMany rather than one lookup per event, and artist/venue
// resolution is memoised per run (a 50-date residency at one venue
// resolves that venue once, not fifty times).

import type { PrismaClient } from "@prisma/client";
import {
  freshSummary,
  normalizeText,
  type IngestSummary,
  type NormalizedEvent,
} from "./ingestTypes.js";
import { resolveArtist, resolveVenue } from "./showResolution.js";
import { normalizeName, fuzzyRatio } from "./providerMatch.js";

export type IngestEngineDeps = {
  prisma: PrismaClient;
  now?: () => Date;
  /**
   * Cap on Shows created/updated in one run. Hitting it ends the run
   * cleanly and the next one resumes — everything already written is
   * skipped by the batched ref lookup, so progress is never redone.
   */
  maxWrites?: number;
  /**
   * Wall-clock deadline. The REAL guard, because a write-count cap
   * cannot protect a time limit when per-write latency varies: Vercel
   * runs in iad1 while Supabase is us-west-2, so a write costs ~1s
   * cross-region but ~10ms locally. A count tuned for one is wrong for
   * the other, and being wrong means a 504 with the IngestRun row stuck
   * at "running". Stop starting new work past this instant.
   */
  deadline?: Date;
};

/** Above this, two artist/venue names are near-identical enough to be worth a human look. */
const NEAR_DUPLICATE_RATIO = 0.9;

const DEFAULT_MAX_WRITES = 600;

export async function ingestNormalizedEvents(
  events: NormalizedEvent[],
  deps: IngestEngineDeps,
): Promise<IngestSummary> {
  const now = deps.now ?? (() => new Date());
  const maxWrites = deps.maxWrites ?? DEFAULT_MAX_WRITES;
  const provider = events[0]?.provider ?? "unknown";
  const summary = freshSummary(provider);
  summary.fetched = events.length;

  if (events.length === 0) return summary;

  // ---- 1. Validate + de-duplicate within the batch ------------------------
  const seenIds = new Set<string>();
  const valid: NormalizedEvent[] = [];
  for (const e of events) {
    if (seenIds.has(e.providerEventId)) {
      summary.skipped.duplicateInBatch++;
      continue;
    }
    seenIds.add(e.providerEventId);

    if (!normalizeText(e.artist?.name)) {
      // ~3% of Ticketmaster music events carry no attraction. Inventing an
      // artist from the event title produces junk rows like "Tour
      // Experience", so these are dropped and counted instead.
      summary.skipped.missingArtist++;
      continue;
    }
    if (!normalizeText(e.venue?.name) || !normalizeText(e.venue?.city)) {
      summary.skipped.missingVenue++;
      continue;
    }
    if (!(e.localDate instanceof Date) || Number.isNaN(e.localDate.getTime())) {
      summary.skipped.invalidDate++;
      continue;
    }
    valid.push(e);
  }

  if (valid.length === 0) return summary;

  // ---- 2. Batched idempotency check ---------------------------------------
  // One query for the whole slice. Anything already linked to this
  // provider is a candidate for "unchanged" and costs no further reads.
  const existingRefs = await deps.prisma.showExternalRef.findMany({
    where: {
      provider,
      providerEventId: { in: valid.map((e) => e.providerEventId) },
    },
    select: {
      id: true,
      providerEventId: true,
      showId: true,
      show: { select: { id: true, status: true, startDatetimeUtc: true } },
    },
  });
  const refByEventId = new Map(existingRefs.map((r) => [r.providerEventId, r]));

  // ---- 3. Candidate lists for near-duplicate detection --------------------
  // Two queries, once per run, so the per-event fuzzy check is in-memory.
  const [allArtists, allVenues] = [
    await deps.prisma.artist.findMany({ select: { id: true, name: true } }),
    await deps.prisma.venue.findMany({
      select: { id: true, name: true, city: true },
    }),
  ];
  const artistIndex = allArtists.map((a) => ({
    ...a,
    norm: normalizeName(a.name),
  }));
  const venueIndex = allVenues.map((v) => ({
    ...v,
    norm: normalizeName(v.name),
  }));

  // Per-run memoisation. Keyed on provider id when present, else the
  // normalised name, so a residency resolves its venue once.
  const artistCache = new Map<string, { id: string; name: string }>();
  const venueCache = new Map<string, { id: string; name: string }>();

  const touchedRefIds: string[] = [];
  let writes = 0;
  const outOfTime = () =>
    deps.deadline !== undefined && now().getTime() >= deps.deadline.getTime();

  for (const e of valid) {
    try {
      const existing = refByEventId.get(e.providerEventId);

      // ---- 3a. Already linked: update only if the provider changed something
      if (existing) {
        touchedRefIds.push(existing.id);
        const statusChanged = existing.show.status !== e.status;

        // A DIFFERENT TIME IS NOT A RESCHEDULE.
        //
        // Providers list one real show under several event ids — resale,
        // platinum, presale — and those listings disagree with each other
        // about the start time. Measured on live Ticketmaster data: 81
        // shows carried more than one event id, and 3 of 6 sampled had
        // conflicting times among their own listings (e.g. 00:00 vs 03:00).
        //
        // Letting each listing write its own time makes them fight: every
        // run "updates" the same rows, forever, and ingestion is never
        // idempotent. It showed up as a stubborn updated=35 on every pass
        // after creates had gone to zero.
        //
        // So a new time is accepted only when the provider EXPLICITLY says
        // the schedule moved, or when we are filling in a time we never
        // had (the show was created from a date with no clock time, and
        // startDatetimeUtc is still the localDate placeholder).
        const hasRealTime =
          existing.show.startDatetimeUtc.getTime() !== e.localDate.getTime();
        const providerSignalledMove =
          e.status === "rescheduled" || e.status === "postponed";
        const timeChanged =
          e.startDatetimeUtc !== null &&
          existing.show.startDatetimeUtc.getTime() !==
            e.startDatetimeUtc.getTime() &&
          (!hasRealTime || providerSignalledMove);

        if (!statusChanged && !timeChanged) {
          summary.skipped.unchanged++;
          continue;
        }
        if (writes >= maxWrites || outOfTime()) {
          summary.skipped.writeBudgetReached++;
          summary.budgetExhausted = true;
          continue;
        }
        await deps.prisma.show.update({
          where: { id: existing.showId },
          data: {
            status: e.status,
            ...(timeChanged && e.startDatetimeUtc
              ? { startDatetimeUtc: e.startDatetimeUtc }
              : {}),
          },
        });
        writes++;
        summary.updated++;
        continue;
      }

      // ---- 3b. Not linked yet: resolve entities, then find-or-create -------
      if (writes >= maxWrites || outOfTime()) {
        summary.skipped.writeBudgetReached++;
        summary.budgetExhausted = true;
        continue;
      }

      const artistName = normalizeText(e.artist.name);
      const venueName = normalizeText(e.venue.name);
      const venueCity = normalizeText(e.venue.city);

      const artistKey = e.artist.providerId
        ? `id:${e.artist.providerId}`
        : `nm:${normalizeName(artistName)}`;
      let artist = artistCache.get(artistKey);
      if (!artist) {
        const before = artistIndex.some(
          (a) => a.norm === normalizeName(artistName),
        );
        artist = await resolveArtist(
          {
            name: artistName,
            externalIds: e.artist.providerId
              ? [{ provider: e.provider, id: e.artist.providerId }]
              : [],
          },
          { prisma: deps.prisma },
        );
        artistCache.set(artistKey, artist);

        // Brand-new artist that looks a lot like one we already had.
        // Recall wins: create it anyway and queue a merge for a human,
        // rather than dropping a real show on a guess.
        if (!before) {
          const near = nearestMatch(normalizeName(artistName), artistIndex);
          if (near && near.ratio >= NEAR_DUPLICATE_RATIO) {
            await queueReview(deps, e, {
              reason: `near_duplicate_artist:${near.name}`,
              resolvedArtistId: artist.id,
            });
            summary.needsReview++;
          }
          artistIndex.push({
            id: artist.id,
            name: artist.name,
            norm: normalizeName(artist.name),
          });
        }
      }

      const venueKey = e.venue.providerId
        ? `id:${e.venue.providerId}`
        : `nm:${normalizeName(venueName)}|${normalizeName(venueCity)}`;
      let venue = venueCache.get(venueKey);
      if (!venue) {
        const before = venueIndex.some(
          (v) =>
            v.norm === normalizeName(venueName) &&
            normalizeName(v.city) === normalizeName(venueCity),
        );
        venue = await resolveVenue(
          {
            name: venueName,
            city: venueCity,
            ...(e.venue.providerId && e.provider === "ticketmaster"
              ? { ticketmasterId: e.venue.providerId }
              : {}),
            ...(e.venue.providerId && e.provider === "dice"
              ? { diceId: e.venue.providerId }
              : {}),
          },
          { prisma: deps.prisma },
        );
        venueCache.set(venueKey, venue);
        if (!before) {
          venueIndex.push({
            id: venue.id,
            name: venue.name,
            city: venueCity,
            norm: normalizeName(venue.name),
          });
        }
      }

      // Find-or-create on the natural key. THIS is where cross-provider
      // dedupe happens: DICE and Ticketmaster reporting the same night
      // land on the same row because they resolved to the same Artist and
      // Venue. (And see the one-artist-per-show note in ingestTypes.ts —
      // a co-headline bill still produces one row per artist today.)
      const existingShow = await deps.prisma.show.findUnique({
        where: {
          artistId_venueId_localDate: {
            artistId: artist.id,
            venueId: venue.id,
            localDate: e.localDate,
          },
        },
        select: { id: true, status: true },
      });

      let showId: string;
      if (existingShow) {
        showId = existingShow.id;
        summary.matched++;
        if (existingShow.status !== e.status) {
          await deps.prisma.show.update({
            where: { id: showId },
            data: { status: e.status },
          });
          summary.updated++;
        }
      } else {
        const created = await deps.prisma.show.create({
          data: {
            artistId: artist.id,
            venueId: venue.id,
            localDate: e.localDate,
            startDatetimeUtc: e.startDatetimeUtc ?? e.localDate,
            status: e.status,
            ...(e.timezone ? { timezone: e.timezone } : {}),
          },
          select: { id: true },
        });
        showId = created.id;
        summary.created++;
      }
      writes++;

      const ref = await deps.prisma.showExternalRef.upsert({
        where: {
          provider_providerEventId: {
            provider: e.provider,
            providerEventId: e.providerEventId,
          },
        },
        update: { showId, lastSeenAt: now() },
        create: {
          provider: e.provider,
          providerEventId: e.providerEventId,
          showId,
          lastSeenAt: now(),
          ...(e.raw !== undefined ? { rawPayload: e.raw as object } : {}),
        },
        select: { id: true },
      });
      touchedRefIds.push(ref.id);
    } catch {
      // One bad event must not abort the slice.
      summary.errors++;
    }
  }

  // ---- 4. Freshness stamp, batched ----------------------------------------
  // Records that the provider still lists these events. Purely
  // informational — nothing reads it to decide deletion, because nothing
  // deletes.
  if (touchedRefIds.length > 0) {
    await deps.prisma.showExternalRef.updateMany({
      where: { id: { in: touchedRefIds } },
      data: { lastSeenAt: now() },
    });
  }

  return summary;
}

function nearestMatch(
  norm: string,
  index: { id: string; name: string; norm: string }[],
): { id: string; name: string; ratio: number } | null {
  let best: { id: string; name: string; ratio: number } | null = null;
  for (const c of index) {
    if (c.norm === norm) continue;
    const ratio = fuzzyRatio(norm, c.norm);
    if (!best || ratio > best.ratio) best = { id: c.id, name: c.name, ratio };
  }
  return best;
}

async function queueReview(
  deps: IngestEngineDeps,
  e: NormalizedEvent,
  opts: { reason: string; resolvedArtistId?: string },
): Promise<void> {
  try {
    await deps.prisma.providerMatchReview.upsert({
      where: {
        provider_providerEventId: {
          provider: e.provider,
          providerEventId: e.providerEventId,
        },
      },
      update: {},
      create: {
        provider: e.provider,
        providerEventId: e.providerEventId,
        rawPayload: (e.raw ?? {}) as object,
        candidateShowIds: [],
        reason: opts.reason,
        ...(opts.resolvedArtistId
          ? { resolvedArtistId: opts.resolvedArtistId }
          : {}),
      },
    });
  } catch {
    // Triage is best-effort; never let it fail an ingestion run.
  }
}
