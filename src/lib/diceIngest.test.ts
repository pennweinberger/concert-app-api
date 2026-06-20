import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyDiceDecision, runDiceIngestion } from "./diceIngest.js";
import type { MatchDecision } from "./providerMatch.js";
import type { DiceMusicEvent } from "./diceParse.js";
import type { DiceSeedVenue } from "./diceVenues.js";

const fixedNow = new Date("2026-06-20T12:00:00.000Z");
const localDate = new Date("2026-06-20T00:00:00.000Z");

const sampleEvent: DiceMusicEvent = {
  providerEventId: "pyb9mp",
  url: "https://dice.fm/event/pyb9mp-themba-tickets",
  name: "THEMBA, TH4YS",
  startDate: "2026-06-20T22:30:00-04:00",
  endDate: "2026-06-21T04:00:00-04:00",
  eventStatus: "https://schema.org/EventScheduled",
  locationName: "Elsewhere, Brooklyn",
  locationAddress: "599 Johnson Ave #1, Brooklyn, NY 11237, USA",
  imageUrls: ["https://dice-media.imgix.net/foo.jpg"],
  description: null,
};

function makeMockPrisma() {
  const upsertShowExternalRef = vi.fn().mockResolvedValue({});
  const upsertProviderMatchReview = vi.fn().mockResolvedValue({});
  const upsertShow = vi.fn().mockResolvedValue({ id: "show_new" });

  const txClient = {
    show: { upsert: upsertShow },
    showExternalRef: { upsert: upsertShowExternalRef },
  };
  const $transaction = vi.fn().mockImplementation(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (t: typeof txClient) => Promise<unknown>)(txClient);
    }
    if (Array.isArray(arg)) return Promise.all(arg);
    throw new Error("unexpected $transaction arg shape");
  });

  return {
    prisma: {
      show: { upsert: upsertShow },
      showExternalRef: { upsert: upsertShowExternalRef },
      providerMatchReview: { upsert: upsertProviderMatchReview },
      $transaction,
    } as unknown as import("@prisma/client").PrismaClient,
    mocks: {
      upsertShow,
      upsertShowExternalRef,
      upsertProviderMatchReview,
      $transaction,
    },
  };
}

function makeDeps(prisma: import("@prisma/client").PrismaClient) {
  return { prisma, now: () => fixedNow };
}

// ---------------------------------------------------------------------------
// applyDiceDecision — AUTO_MERGE
// ---------------------------------------------------------------------------

describe("applyDiceDecision — AUTO_MERGE", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("upserts ShowExternalRef(provider='dice') against the existing showId", async () => {
    const decision: MatchDecision = {
      action: "AUTO_MERGE",
      artistId: "a_existing",
      venueId: "v_existing",
      showId: "s_existing",
      candidateShowIds: [],
      reason: "exact_match",
    };
    await applyDiceDecision(
      {
        decision,
        event: sampleEvent,
        localDate,
        canonicalVenueId: "v_existing",
        diceShortId: "8p85",
      },
      makeDeps(setup.prisma),
    );
    expect(setup.mocks.upsertShowExternalRef).toHaveBeenCalledOnce();
    const call = setup.mocks.upsertShowExternalRef.mock.calls[0]![0];
    expect(call.where).toEqual({
      provider_providerEventId: {
        provider: "dice",
        providerEventId: "pyb9mp",
      },
    });
    expect(call.create).toMatchObject({
      showId: "s_existing",
      provider: "dice",
      providerEventId: "pyb9mp",
    });
    expect(call.create.rawPayload).toEqual(sampleEvent);
    // No new Show, no transaction, no review row
    expect(setup.mocks.upsertShow).not.toHaveBeenCalled();
    expect(setup.mocks.$transaction).not.toHaveBeenCalled();
    expect(setup.mocks.upsertProviderMatchReview).not.toHaveBeenCalled();
  });

  it("throws if AUTO_MERGE somehow has null showId (invariant guard)", async () => {
    const decision: MatchDecision = {
      action: "AUTO_MERGE",
      artistId: "a",
      venueId: "v",
      showId: null,
      candidateShowIds: [],
      reason: "bug",
    };
    await expect(
      applyDiceDecision(
        {
          decision,
          event: sampleEvent,
          localDate,
          canonicalVenueId: "v",
          diceShortId: "8p85",
        },
        makeDeps(setup.prisma),
      ),
    ).rejects.toThrow(/AUTO_MERGE without showId/);
  });
});

// ---------------------------------------------------------------------------
// applyDiceDecision — REVIEW
// ---------------------------------------------------------------------------

describe("applyDiceDecision — REVIEW", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("upserts ProviderMatchReview with provider='dice' as idempotency key", async () => {
    const decision: MatchDecision = {
      action: "REVIEW",
      artistId: null,
      venueId: "v_canonical",
      showId: null,
      candidateShowIds: ["s_candidate_1"],
      reason: "artist:artist_fuzzy|venue:dice_external_ref_match|show:no_show_match",
    };
    await applyDiceDecision(
      {
        decision,
        event: sampleEvent,
        localDate,
        canonicalVenueId: "v_canonical",
        diceShortId: "8p85",
      },
      makeDeps(setup.prisma),
    );
    expect(setup.mocks.upsertProviderMatchReview).toHaveBeenCalledOnce();
    const call = setup.mocks.upsertProviderMatchReview.mock.calls[0]![0];
    expect(call.where).toEqual({
      provider_providerEventId: {
        provider: "dice",
        providerEventId: "pyb9mp",
      },
    });
    expect(call.create).toMatchObject({
      provider: "dice",
      providerEventId: "pyb9mp",
      resolvedArtistId: null,
      resolvedVenueId: "v_canonical",
      candidateShowIds: ["s_candidate_1"],
      status: "pending",
    });
    expect(call.create.rawPayload).toEqual(sampleEvent);
    // NO ShowExternalRef on REVIEW path (per user spec)
    expect(setup.mocks.upsertShowExternalRef).not.toHaveBeenCalled();
    expect(setup.mocks.upsertShow).not.toHaveBeenCalled();
    expect(setup.mocks.$transaction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// applyDiceDecision — CREATE_NEW
// ---------------------------------------------------------------------------

describe("applyDiceDecision — CREATE_NEW", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("upserts Show on (artistId, venueId, localDate) then ShowExternalRef in a transaction", async () => {
    const decision: MatchDecision = {
      action: "CREATE_NEW",
      artistId: "a_new",
      venueId: "v_canonical",
      showId: null,
      candidateShowIds: [],
      reason: "create_new",
    };
    await applyDiceDecision(
      {
        decision,
        event: sampleEvent,
        localDate,
        canonicalVenueId: "v_canonical",
        diceShortId: "8p85",
      },
      makeDeps(setup.prisma),
    );
    expect(setup.mocks.$transaction).toHaveBeenCalledOnce();
    expect(setup.mocks.upsertShow).toHaveBeenCalledOnce();
    const showCall = setup.mocks.upsertShow.mock.calls[0]![0];
    expect(showCall.where).toEqual({
      artistId_venueId_localDate: {
        artistId: "a_new",
        venueId: "v_canonical",
        localDate,
      },
    });
    expect(showCall.create).toMatchObject({
      artistId: "a_new",
      venueId: "v_canonical",
      localDate,
    });
    // startDatetimeUtc parsed from event.startDate
    expect(showCall.create.startDatetimeUtc).toEqual(
      new Date("2026-06-20T22:30:00-04:00"),
    );

    expect(setup.mocks.upsertShowExternalRef).toHaveBeenCalledOnce();
    const refCall = setup.mocks.upsertShowExternalRef.mock.calls[0]![0];
    expect(refCall.create).toMatchObject({
      provider: "dice",
      providerEventId: "pyb9mp",
      showId: "show_new",
    });
    expect(refCall.create.rawPayload).toEqual(sampleEvent);
  });

  it("throws on CREATE_NEW without a resolved artistId (invariant)", async () => {
    const decision: MatchDecision = {
      action: "CREATE_NEW",
      artistId: null,
      venueId: "v_canonical",
      showId: null,
      candidateShowIds: [],
      reason: "bug",
    };
    await expect(
      applyDiceDecision(
        {
          decision,
          event: sampleEvent,
          localDate,
          canonicalVenueId: "v_canonical",
          diceShortId: "8p85",
        },
        makeDeps(setup.prisma),
      ),
    ).rejects.toThrow(/CREATE_NEW without resolved artistId/);
  });

  it("throws on CREATE_NEW venueId mismatch (defensive — should never happen)", async () => {
    const decision: MatchDecision = {
      action: "CREATE_NEW",
      artistId: "a_new",
      venueId: "v_DIFFERENT",
      showId: null,
      candidateShowIds: [],
      reason: "bug",
    };
    await expect(
      applyDiceDecision(
        {
          decision,
          event: sampleEvent,
          localDate,
          canonicalVenueId: "v_canonical",
          diceShortId: "8p85",
        },
        makeDeps(setup.prisma),
      ),
    ).rejects.toThrow(/venueId mismatch/);
  });
});

// ---------------------------------------------------------------------------
// runDiceIngestion — sort/limit/skip behavior (chunking)
// ---------------------------------------------------------------------------

describe("runDiceIngestion — chunking", () => {
  const seed: DiceSeedVenue[] = [
    { canonicalName: "Venue A", city: "Brooklyn", diceShortIds: ["aaa"] },
    { canonicalName: "Venue B", city: "Brooklyn", diceShortIds: ["bbb"] },
    { canonicalName: "Venue C", city: "Brooklyn", diceShortIds: ["ccc"] },
    { canonicalName: "Venue D", city: "Brooklyn", diceShortIds: ["ddd"] },
  ];

  function makeRunSetup() {
    const findVenues = vi.fn();
    const updateVenue = vi.fn().mockResolvedValue({});
    const fetched: string[] = [];
    const fetchVenuePageHtml = vi.fn(async (shortId: string) => {
      fetched.push(shortId);
      // Return HTML with a Place JSON-LD but zero events — keeps the
      // orchestrator quick and avoids exercising the per-event pipeline.
      return `<script type="application/ld+json">${JSON.stringify({
        "@type": "Place",
        name: "x",
        address: "Street, Brooklyn, NY 11211, USA",
        event: [],
      })}</script>`;
    });
    const findManyArtists = vi.fn().mockResolvedValue([]);
    const findManyShows = vi.fn().mockResolvedValue([]);
    return {
      fetched,
      prisma: {
        venue: { findMany: findVenues, update: updateVenue },
        artist: { findMany: findManyArtists },
        show: { findMany: findManyShows },
      } as unknown as import("@prisma/client").PrismaClient,
      mocks: { findVenues, updateVenue, fetchVenuePageHtml },
    };
  }

  it("first run from cold state (all NULL lastDiceFetchAt): processes the first `limit` venues in seed order", async () => {
    const s = makeRunSetup();
    s.mocks.findVenues.mockResolvedValueOnce([]); // no venues in DB yet
    const summary = await runDiceIngestion({
      prisma: s.prisma,
      fetchVenuePageHtml: s.mocks.fetchVenuePageHtml,
      now: () => new Date("2026-06-20T18:00:00.000Z"),
      seed,
      limit: 2,
    });
    expect(summary.processedDiceVenues).toBe(2);
    expect(summary.skippedRecentlyFetched).toBe(0);
    expect(s.fetched).toEqual(["aaa", "bbb"]);
  });

  it("skips venues fetched within minHoursBetweenFetches, processes the stalest", async () => {
    const s = makeRunSetup();
    const now = new Date("2026-06-20T18:00:00.000Z");
    // A fetched 1h ago (skip), B fetched 12h ago (eligible, stale),
    // C never fetched (eligible, NULL → stalest)
    // D fetched 8h ago (eligible)
    s.mocks.findVenues.mockResolvedValueOnce([
      { name: "Venue A", city: "Brooklyn", lastDiceFetchAt: new Date(now.getTime() - 1 * 3_600_000) },
      { name: "Venue B", city: "Brooklyn", lastDiceFetchAt: new Date(now.getTime() - 12 * 3_600_000) },
      { name: "Venue D", city: "Brooklyn", lastDiceFetchAt: new Date(now.getTime() - 8 * 3_600_000) },
    ]);
    const summary = await runDiceIngestion({
      prisma: s.prisma,
      fetchVenuePageHtml: s.mocks.fetchVenuePageHtml,
      now: () => now,
      seed,
      limit: 5,
      minHoursBetweenFetches: 6,
    });
    expect(summary.skippedRecentlyFetched).toBe(1); // A
    // Order should be: C (NULL/stalest), B (12h), D (8h). A is skipped.
    expect(s.fetched).toEqual(["ccc", "bbb", "ddd"]);
  });

  it("force-refresh with minHoursBetweenFetches=0 processes everything regardless of recency", async () => {
    const s = makeRunSetup();
    const now = new Date("2026-06-20T18:00:00.000Z");
    s.mocks.findVenues.mockResolvedValueOnce([
      { name: "Venue A", city: "Brooklyn", lastDiceFetchAt: new Date(now.getTime() - 60_000) },
      { name: "Venue B", city: "Brooklyn", lastDiceFetchAt: new Date(now.getTime() - 60_000) },
    ]);
    const summary = await runDiceIngestion({
      prisma: s.prisma,
      fetchVenuePageHtml: s.mocks.fetchVenuePageHtml,
      now: () => now,
      seed: seed.slice(0, 2),
      limit: 5,
      minHoursBetweenFetches: 0,
    });
    expect(summary.skippedRecentlyFetched).toBe(0);
    expect(summary.processedDiceVenues).toBe(2);
  });
});
