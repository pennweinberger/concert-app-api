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
  eventStatus: "https://schema.org/EventScheduled",
  locationName: "Elsewhere, Brooklyn",
};

// The one payload shape DICE is allowed to persist (dice-minimal-v1).
// Written out literally rather than derived from toDiceRawPayload, so a
// change to the builder can't quietly change what these tests expect.
const expectedPayload = {
  _schema: "dice-minimal-v1",
  url: "https://dice.fm/event/pyb9mp-themba-tickets",
  name: "THEMBA, TH4YS",
  startDate: "2026-06-20T22:30:00-04:00",
  eventStatus: "https://schema.org/EventScheduled",
  locationName: "Elsewhere, Brooklyn",
};

const ALLOWED_PAYLOAD_KEYS = Object.keys(expectedPayload).sort();

/** Every rawPayload in a mock's create/update calls has exactly the approved keys. */
function expectOnlyMinimalPayloads(mockFn: { mock: { calls: any[][] } }) {
  const payloads = mockFn.mock.calls.flatMap((c) =>
    [c[0]?.create?.rawPayload, c[0]?.update?.rawPayload].filter(
      (p) => p !== undefined,
    ),
  );
  expect(payloads.length).toBeGreaterThan(0);
  for (const p of payloads) {
    expect(Object.keys(p).sort()).toEqual(ALLOWED_PAYLOAD_KEYS);
    expect(p).not.toHaveProperty("description");
    expect(p).not.toHaveProperty("imageUrls");
  }
}

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
    expect(call.create.rawPayload).toEqual(expectedPayload);
    // Update branch too: re-seeing an event must not re-store content.
    expectOnlyMinimalPayloads(setup.mocks.upsertShowExternalRef);
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
    expect(call.create.rawPayload).toEqual(expectedPayload);
    // Update branch too: re-seeing an event must not re-store content.
    expectOnlyMinimalPayloads(setup.mocks.upsertProviderMatchReview);
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
    expect(refCall.create.rawPayload).toEqual(expectedPayload);
    // Update branch too: re-seeing an event must not re-store content.
    expectOnlyMinimalPayloads(setup.mocks.upsertShowExternalRef);
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
    // upsertVenue is called by the zero-event fallback path so we can
    // mark lastDiceFetchAt even when DICE returned no events.
    const upsertVenueMock = vi.fn().mockImplementation(async (args: any) => ({
      id: `venue_${args.where.name_city.name.replace(/\s+/g, "_")}`,
      name: args.where.name_city.name,
      city: args.where.name_city.city,
    }));
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
        venue: {
          findMany: findVenues,
          update: updateVenue,
          upsert: upsertVenueMock,
        },
        artist: { findMany: findManyArtists },
        // Health check: no venue in these fixtures has upcoming DICE shows.
        show: { findMany: findManyShows, count: vi.fn().mockResolvedValue(0) },
      } as unknown as import("@prisma/client").PrismaClient,
      mocks: {
        findVenues,
        updateVenue,
        fetchVenuePageHtml,
        upsertVenueMock,
      },
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

// ---------------------------------------------------------------------------
// runDiceIngestion — health checks (parser drift / quiet active venues)
// ---------------------------------------------------------------------------

describe("runDiceIngestion — health", () => {
  const now = new Date("2026-09-13T09:00:00.000Z");
  const twoVenues: DiceSeedVenue[] = [
    { canonicalName: "Venue A", city: "Brooklyn", diceShortIds: ["aaa"] },
    { canonicalName: "Venue B", city: "Brooklyn", diceShortIds: ["bbb"] },
  ];

  // Invented events that only mimic DICE's JSON-LD shapes.
  const newFormatEvent = (i: number) => ({
    "@type": "Event",
    url: `https://dice.fm/event/0123456789abcdef0123456${i}`,
    name: `Invented Act ${i}`,
    startDate: "2026-10-02T22:30:00-04:00",
    location: { "@type": "Place", name: "Test Room, Brooklyn" },
  });
  const legacyEvent = (i: number) => ({
    ...newFormatEvent(i),
    "@type": "MusicEvent",
    url: `https://dice.fm/event/abc12${i}-invented-act-tickets`,
  });
  const page = (events: unknown[]) =>
    `<script type="application/ld+json">${JSON.stringify({
      "@type": "Place",
      name: "Test Room, Brooklyn",
      address: "1 Test St, Brooklyn, NY 11211, USA",
      event: events,
    })}</script>`;

  function makeHealthSetup(opts: {
    pages: Record<string, string | Error>;
    upcomingDiceShowsByVenue?: Record<string, number>;
    artistLookupFails?: boolean;
  }) {
    const updateVenue = vi.fn().mockResolvedValue({});
    const countShows = vi.fn(async (args: any) =>
      opts.upcomingDiceShowsByVenue?.[args.where.venueId] ?? 0,
    );
    const prisma = {
      venue: {
        findMany: vi.fn().mockResolvedValue([]),
        update: updateVenue,
        upsert: vi.fn(async (args: any) => ({
          id: `venue_${args.where.name_city.name.replace(/\s+/g, "_")}`,
          name: args.where.name_city.name,
          city: args.where.name_city.city,
        })),
      },
      artist: {
        findMany: opts.artistLookupFails
          ? vi.fn().mockRejectedValue(new Error("simulated processing failure"))
          : vi.fn().mockResolvedValue([]),
      },
      show: { findMany: vi.fn().mockResolvedValue([]), count: countShows },
    } as unknown as import("@prisma/client").PrismaClient;
    const fetchVenuePageHtml = vi.fn(async (shortId: string) => {
      const p = opts.pages[shortId];
      if (p instanceof Error) throw p;
      return p ?? page([]);
    });
    return { prisma, fetchVenuePageHtml, updateVenue, countShows };
  }

  const run = (s: ReturnType<typeof makeHealthSetup>, seed = twoVenues) =>
    runDiceIngestion({
      prisma: s.prisma,
      fetchVenuePageHtml: s.fetchVenuePageHtml,
      now: () => now,
      seed,
      limit: 5,
    });

  /**
   * The actual September 2026 failure: the page lists events, the parser
   * accepts none, and the run used to come back as a clean success.
   */
  it("flags parser drift when a page lists events the parser accepts none of", async () => {
    const s = makeHealthSetup({
      pages: { aaa: page([newFormatEvent(1), newFormatEvent(2), newFormatEvent(3)]) },
    });
    const summary = await run(s, twoVenues.slice(0, 1));

    expect(summary.eventsConsidered).toBe(0);
    expect(summary.errors).toBe(0); // exactly why this used to be invisible
    expect(summary.jsonLdEventsSeen).toBe(3);
    expect(summary.driftPages).toEqual([
      { diceShortId: "aaa", rawEventCount: 3, rawEventTypes: ["Event"] },
    ]);
    expect(summary.health).toEqual({ status: "unhealthy", reasons: ["parser_drift"] });
    // Monitoring observes; it does not abort the run's normal bookkeeping.
    expect(s.updateVenue).toHaveBeenCalledOnce();
  });

  it("flags zero events from two known-active venues", async () => {
    const s = makeHealthSetup({
      pages: {},
      upcomingDiceShowsByVenue: { venue_Venue_A: 4, venue_Venue_B: 2 },
    });
    const summary = await run(s);
    expect(summary.activeVenuesWithZeroEvents).toEqual(["Venue A", "Venue B"]);
    expect(summary.health).toEqual({
      status: "unhealthy",
      reasons: ["zero_events_from_active_venues"],
    });
    // Scoped to future shows at that venue that came from DICE.
    const where = s.countShows.mock.calls[0]![0].where;
    expect(where).toMatchObject({
      venueId: "venue_Venue_A",
      externalRefs: { some: { provider: "dice" } },
    });
    expect(where.localDate.gte).toEqual(new Date("2026-09-13T00:00:00.000Z"));
  });

  it("stays healthy when only one active venue is quiet, or quiet venues have nothing upcoming", async () => {
    const s = makeHealthSetup({ pages: {}, upcomingDiceShowsByVenue: { venue_Venue_A: 3 } });
    const summary = await run(s);
    expect(summary.activeVenuesWithZeroEvents).toEqual(["Venue A"]);
    expect(summary.health).toEqual({ status: "healthy", reasons: [] });
  });

  it("counts fetch failures at known-active venues as zero events", async () => {
    const s = makeHealthSetup({
      pages: { aaa: new Error("HTTP 503"), bbb: new Error("HTTP 503") },
      upcomingDiceShowsByVenue: { venue_Venue_A: 1, venue_Venue_B: 1 },
    });
    const summary = await run(s);
    expect(summary.errors).toBe(2);
    expect(summary.health.reasons).toEqual(["zero_events_from_active_venues"]);
  });

  it("is healthy when events are accepted, without querying for activity", async () => {
    // Processing is made to fail after acceptance: acceptance, not a
    // successful write, is what proves the parser still understands the page.
    const s = makeHealthSetup({
      pages: { aaa: page([legacyEvent(1), legacyEvent(2)]) },
      upcomingDiceShowsByVenue: { venue_Venue_A: 5 },
      artistLookupFails: true,
    });
    const summary = await run(s, twoVenues.slice(0, 1));
    expect(summary.eventsConsidered).toBe(2);
    expect(summary.driftPages).toEqual([]);
    expect(summary.health).toEqual({ status: "healthy", reasons: [] });
    expect(s.countShows).not.toHaveBeenCalled();
  });

  it("never lets the activity lookup break ingestion", async () => {
    const s = makeHealthSetup({ pages: {} });
    (s.countShows as any).mockRejectedValue(new Error("db hiccup"));
    const summary = await run(s);
    expect(summary.processedDiceVenues).toBe(2);
    expect(summary.health.status).toBe("healthy");
  });
});
