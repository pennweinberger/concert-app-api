import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyBoweryDecision, runBoweryIngestion } from "./boweryIngest.js";
import type { MatchDecision } from "./providerMatch.js";
import type { BoweryEvent } from "./boweryParse.js";

const fixedNow = new Date("2026-06-24T12:00:00.000Z");
const localDate = new Date("2026-09-16T00:00:00.000Z");

const sampleEvent: BoweryEvent = {
  eventId: "1416004",
  eventDateTimeISO: "2026-09-16T19:00:00-04:00",
  title: {
    headlinersText: "The Hayley Williams Show",
    supportingText: "Magdalena Bay + RICO NASTY",
    tour: null,
    eventTitleText: "The Hayley Williams Show",
  },
  venue: {
    venueId: "124944",
    title: "Forest Hills Stadium",
    city: "Forest Hills",
    state: "NY",
    address_line: "1 Tennis Place, Forest Hills, NY 11375",
    timezone: "America/New_York",
  },
  ticketing: {
    status: "Buy Tickets",
    statusId: 1,
    ticketURL: "https://shop.axs.com/?c=axs&e=...",
    url: "https://www.axs.com/events/1416004/...",
    eventUrl: "https://www.axs.com/events/1416004/...",
  },
  active: true,
  publishStatus: 1,
  private: false,
  raw: { eventId: "1416004", _passthrough: true },
};

// ---------------------------------------------------------------------------
// applyBoweryDecision — verifies provider="bowery" + raw payload
// ---------------------------------------------------------------------------

function makeApplyMocks() {
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
    throw new Error("unexpected $transaction arg shape");
  });

  return {
    prisma: {
      show: { upsert: upsertShow },
      showExternalRef: { upsert: upsertShowExternalRef },
      providerMatchReview: { upsert: upsertProviderMatchReview },
      $transaction,
    } as unknown as import("@prisma/client").PrismaClient,
    mocks: { upsertShow, upsertShowExternalRef, upsertProviderMatchReview, $transaction },
  };
}

describe("applyBoweryDecision", () => {
  let setup: ReturnType<typeof makeApplyMocks>;
  beforeEach(() => {
    setup = makeApplyMocks();
  });

  it("AUTO_MERGE upserts ShowExternalRef(provider='bowery') with raw payload", async () => {
    const decision: MatchDecision = {
      action: "AUTO_MERGE",
      artistId: "a_existing",
      venueId: "v_existing",
      showId: "s_existing",
      candidateShowIds: [],
      reason: "exact_match",
    };
    await applyBoweryDecision(
      { decision, event: sampleEvent, localDate, canonicalVenueId: "v_existing" },
      { prisma: setup.prisma, now: () => fixedNow },
    );
    expect(setup.mocks.upsertShowExternalRef).toHaveBeenCalledOnce();
    const call = setup.mocks.upsertShowExternalRef.mock.calls[0]![0];
    expect(call.where).toEqual({
      provider_providerEventId: {
        provider: "bowery",
        providerEventId: "1416004",
      },
    });
    expect(call.create).toMatchObject({
      showId: "s_existing",
      provider: "bowery",
      providerEventId: "1416004",
    });
    expect(call.create.rawPayload).toEqual(sampleEvent.raw);
  });

  it("CREATE_NEW upserts Show then ShowExternalRef inside a transaction", async () => {
    const decision: MatchDecision = {
      action: "CREATE_NEW",
      artistId: "a_new",
      venueId: "v_canonical",
      showId: null,
      candidateShowIds: [],
      reason: "no_show_match",
    };
    await applyBoweryDecision(
      { decision, event: sampleEvent, localDate, canonicalVenueId: "v_canonical" },
      { prisma: setup.prisma, now: () => fixedNow },
    );
    expect(setup.mocks.$transaction).toHaveBeenCalledOnce();
    expect(setup.mocks.upsertShow).toHaveBeenCalledOnce();
    expect(setup.mocks.upsertShowExternalRef).toHaveBeenCalledOnce();
    const refCall = setup.mocks.upsertShowExternalRef.mock.calls[0]![0];
    expect(refCall.create.provider).toBe("bowery");
  });

  it("REVIEW upserts ProviderMatchReview(provider='bowery') with status='pending'", async () => {
    const decision: MatchDecision = {
      action: "REVIEW",
      artistId: null,
      venueId: "v_canonical",
      showId: null,
      candidateShowIds: ["s_maybe"],
      reason: "ambiguous_artist",
    };
    await applyBoweryDecision(
      { decision, event: sampleEvent, localDate, canonicalVenueId: "v_canonical" },
      { prisma: setup.prisma, now: () => fixedNow },
    );
    expect(setup.mocks.upsertProviderMatchReview).toHaveBeenCalledOnce();
    const call = setup.mocks.upsertProviderMatchReview.mock.calls[0]![0];
    expect(call.where).toEqual({
      provider_providerEventId: { provider: "bowery", providerEventId: "1416004" },
    });
    expect(call.create).toMatchObject({
      provider: "bowery",
      providerEventId: "1416004",
      candidateShowIds: ["s_maybe"],
      reason: "ambiguous_artist",
      status: "pending",
    });
  });

  it("AUTO_MERGE without showId throws (defensive)", async () => {
    await expect(
      applyBoweryDecision(
        {
          decision: {
            action: "AUTO_MERGE",
            artistId: "a",
            venueId: "v",
            showId: null,
            candidateShowIds: [],
            reason: "x",
          },
          event: sampleEvent,
          localDate,
          canonicalVenueId: "v",
        },
        { prisma: setup.prisma, now: () => fixedNow },
      ),
    ).rejects.toThrow(/AUTO_MERGE without showId/);
  });
});

// ---------------------------------------------------------------------------
// runBoweryIngestion — allowlist / state / cancelled / dryRun filters
// ---------------------------------------------------------------------------

function makeFeedResponse(events: Record<string, unknown>[]) {
  return {
    rawJson: {
      meta: { total: events.length, locale: "en-US", page: 1, rows: 100 },
      events,
    },
    etag: '"fake-etag"',
    lastModified: "Wed, 24 Jun 2026 11:00:00 GMT",
  };
}

function rawEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "1416004",
    eventDateTimeISO: "2026-09-16T19:00:00-04:00",
    active: true,
    publishStatus: 1,
    private: false,
    title: {
      headlinersText: "The Hayley Williams Show",
      supportingText: null,
      tour: null,
      eventTitleText: "The Hayley Williams Show",
    },
    ticketing: { statusId: 1, status: "Buy Tickets", ticketURL: null, url: null, eventUrl: null },
    venue: {
      venueId: "124944",
      title: "Forest Hills Stadium",
      city: "Forest Hills",
      state: "NY",
      address_line: null,
      timezone: "America/New_York",
    },
    ...overrides,
  };
}

function makeIngestPrisma() {
  // Default behavior: artist search returns no candidates → matchArtist
  // returns NEW; resolveVenue path finds no existing ref → upsert
  // venue → stamp ref; show search returns nothing → NEW; decision is
  // CREATE_NEW; applyBoweryDecision goes through the transaction path.
  return {
    artist: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({
        id: "a_new",
        name: "Anyone",
        ticketmasterId: null,
        diceId: null,
      }),
    },
    venue: {
      upsert: vi.fn().mockResolvedValue({ id: "v_fhs", name: "Forest Hills Stadium", city: "Forest Hills" }),
    },
    venueExternalRef: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    show: { findMany: vi.fn().mockResolvedValue([]) },
    showExternalRef: {
      // findMany used by the pre-fetch skip-already-processed optimization.
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
    },
    providerMatchReview: { upsert: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn().mockImplementation(async (arg: unknown) => {
      const tx = {
        show: { upsert: vi.fn().mockResolvedValue({ id: "s_new" }) },
        showExternalRef: { upsert: vi.fn().mockResolvedValue({}) },
      };
      if (typeof arg === "function") {
        return (arg as (t: typeof tx) => Promise<unknown>)(tx);
      }
      throw new Error("unexpected $transaction arg");
    }),
  } as unknown as import("@prisma/client").PrismaClient;
}

describe("runBoweryIngestion", () => {
  it("processes allowlisted venues and skips others", async () => {
    const feed = makeFeedResponse([
      rawEvent(), // Forest Hills — in allowlist
      rawEvent({
        eventId: "999",
        venue: {
          venueId: "999999", // NOT in allowlist
          title: "Madison Square Garden",
          city: "New York",
          state: "NY",
          address_line: null,
          timezone: "America/New_York",
        },
      }),
    ]);
    const summary = await runBoweryIngestion({
      prisma: makeIngestPrisma(),
      fetchBoweryFeed: vi.fn().mockResolvedValue(feed),
      fetchBoweryPerVenueFeed: vi.fn().mockResolvedValue({
        rawJson: { meta: { total: 0 }, events: [] },
        etag: null,
        lastModified: null,
      }),
      now: () => fixedNow,
    });
    expect(summary.feedEventsParsed).toBe(2);
    expect(summary.allowlistMatched).toBe(1);
    expect(summary.skippedNonAllowlistVenue).toBe(1);
    expect(summary.eventsProcessed).toBe(1);
  });

  it("skips cancelled events", async () => {
    const feed = makeFeedResponse([
      rawEvent({
        ticketing: { statusId: 99, status: "Cancelled", ticketURL: null, url: null, eventUrl: null },
      }),
    ]);
    const summary = await runBoweryIngestion({
      prisma: makeIngestPrisma(),
      fetchBoweryFeed: vi.fn().mockResolvedValue(feed),
      fetchBoweryPerVenueFeed: vi.fn().mockResolvedValue({
        rawJson: { meta: { total: 0 }, events: [] },
        etag: null,
        lastModified: null,
      }),
      now: () => fixedNow,
    });
    expect(summary.allowlistMatched).toBe(1);
    expect(summary.skippedInactive.total).toBe(1);
    expect(summary.skippedInactive.byReason.cancelled).toBe(1);
    expect(summary.eventsProcessed).toBe(0);
    expect(summary.actions.CREATE_NEW).toBe(0);
  });

  it("skips postponed / unpublished / private / inactive separately", async () => {
    const feed = makeFeedResponse([
      rawEvent({ eventId: "p1", ticketing: { statusId: 99, status: "Postponed", ticketURL: null, url: null, eventUrl: null } }),
      rawEvent({ eventId: "p2", publishStatus: 0 }),
      rawEvent({ eventId: "p3", private: true }),
      rawEvent({ eventId: "p4", active: false }),
    ]);
    const summary = await runBoweryIngestion({
      prisma: makeIngestPrisma(),
      fetchBoweryFeed: vi.fn().mockResolvedValue(feed),
      fetchBoweryPerVenueFeed: vi.fn().mockResolvedValue({
        rawJson: { meta: { total: 0 }, events: [] },
        etag: null,
        lastModified: null,
      }),
      now: () => fixedNow,
    });
    expect(summary.skippedInactive.byReason.postponed).toBe(1);
    expect(summary.skippedInactive.byReason.unpublished).toBe(1);
    expect(summary.skippedInactive.byReason.private).toBe(1);
    expect(summary.skippedInactive.byReason.inactive).toBe(1);
    expect(summary.eventsProcessed).toBe(0);
  });

  it("defense in depth: skips non-NY-state events even if venueId is allowlisted", async () => {
    // If the allowlisted venueId 124944 somehow showed up with a
    // different state, we'd still skip it. Synthetic case to test the
    // belt-and-suspenders path.
    const feed = makeFeedResponse([
      rawEvent({
        venue: {
          venueId: "124944",
          title: "Forest Hills Stadium",
          city: "Forest Hills",
          state: "CA", // wrong state
          address_line: null,
          timezone: "America/Los_Angeles",
        },
      }),
    ]);
    const summary = await runBoweryIngestion({
      prisma: makeIngestPrisma(),
      fetchBoweryFeed: vi.fn().mockResolvedValue(feed),
      fetchBoweryPerVenueFeed: vi.fn().mockResolvedValue({
        rawJson: { meta: { total: 0 }, events: [] },
        etag: null,
        lastModified: null,
      }),
      now: () => fixedNow,
    });
    expect(summary.allowlistMatched).toBe(1);
    expect(summary.skippedNonNyState).toBe(1);
    expect(summary.eventsProcessed).toBe(0);
  });

  it("dryRun mode: counts events but writes nothing", async () => {
    const feed = makeFeedResponse([rawEvent()]);
    const prisma = makeIngestPrisma();
    const summary = await runBoweryIngestion({
      prisma,
      fetchBoweryFeed: vi.fn().mockResolvedValue(feed),
      fetchBoweryPerVenueFeed: vi.fn().mockResolvedValue({
        rawJson: { meta: { total: 0 }, events: [] },
        etag: null,
        lastModified: null,
      }),
      now: () => fixedNow,
      dryRun: true,
    });
    expect(summary.dryRun).toBe(true);
    expect(summary.allowlistMatched).toBe(1);
    expect(summary.eventsProcessed).toBe(1);
    // No DB writes (artist.findMany, venue ops, show ops, etc. never called).
    expect((prisma.venue.upsert as any)).not.toHaveBeenCalled();
    expect((prisma.showExternalRef.upsert as any)).not.toHaveBeenCalled();
    expect((prisma.$transaction as any)).not.toHaveBeenCalled();
  });

  it("skips already-processed events on re-runs (cheap path)", async () => {
    const feed = makeFeedResponse([
      rawEvent({ eventId: "already_done" }),
      rawEvent({ eventId: "new_event" }),
    ]);
    const prisma = makeIngestPrisma();
    // Pre-fetch returns one of the two events as already-ingested.
    (prisma.showExternalRef.findMany as any).mockResolvedValue([
      { providerEventId: "already_done" },
    ]);
    const summary = await runBoweryIngestion({
      prisma,
      fetchBoweryFeed: vi.fn().mockResolvedValue(feed),
      fetchBoweryPerVenueFeed: vi.fn().mockResolvedValue({
        rawJson: { meta: { total: 0 }, events: [] },
        etag: null,
        lastModified: null,
      }),
      now: () => fixedNow,
    });
    expect(summary.skippedAlreadyProcessed).toBe(1);
    expect(summary.eventsProcessed).toBe(1);
    // The pre-fetch happened once with the allowed event IDs.
    const prefetchCall = (prisma.showExternalRef.findMany as any).mock.calls[0]![0];
    expect(prefetchCall.where.provider).toBe("bowery");
    expect(prefetchCall.where.providerEventId.in).toEqual([
      "already_done",
      "new_event",
    ]);
  });

  it("dry-run does NOT pre-fetch (avoids unnecessary DB hit)", async () => {
    const feed = makeFeedResponse([rawEvent()]);
    const prisma = makeIngestPrisma();
    await runBoweryIngestion({
      prisma,
      fetchBoweryFeed: vi.fn().mockResolvedValue(feed),
      fetchBoweryPerVenueFeed: vi.fn().mockResolvedValue({
        rawJson: { meta: { total: 0 }, events: [] },
        etag: null,
        lastModified: null,
      }),
      now: () => fixedNow,
      dryRun: true,
    });
    expect((prisma.showExternalRef.findMany as any)).not.toHaveBeenCalled();
  });

  it("merges per-venue feed extras (Forest Hills supplement)", async () => {
    // Regional has Paul Simon at Forest Hills. Per-venue has BOTH Paul
    // Simon (same eventId, dedup) AND Hayley Williams (new — only in
    // per-venue). Expect: Hayley counted as perVenueExtras, Paul Simon
    // not double-counted.
    const paulSimonRegional = rawEvent({
      eventId: "1210894",
      title: {
        headlinersText: "Paul Simon",
        supportingText: null,
        tour: null,
        eventTitleText: "Paul Simon",
      },
    });
    const paulSimonPerVenue = rawEvent({
      eventId: "1210894", // same id — duplicate, must be deduped
      title: {
        headlinersText: "Paul Simon",
        supportingText: null,
        tour: null,
        eventTitleText: "Paul Simon",
      },
    });
    const hayleyPerVenue = rawEvent({
      eventId: "1416004",
      eventDateTimeISO: "2026-09-16T18:00:00-04:00",
      title: {
        headlinersText: '"The Hayley Williams Show"',
        supportingText: null,
        tour: null,
        eventTitleText: '"The Hayley Williams Show"',
      },
    });

    const summary = await runBoweryIngestion({
      prisma: makeIngestPrisma(),
      fetchBoweryFeed: vi.fn().mockResolvedValue(makeFeedResponse([paulSimonRegional])),
      fetchBoweryPerVenueFeed: vi.fn().mockResolvedValue(
        makeFeedResponse([paulSimonPerVenue, hayleyPerVenue]),
      ),
      now: () => fixedNow,
    });

    expect(summary.feedEventsParsed).toBe(1); // regional had 1
    expect(summary.perVenueExtras).toBe(1); // Hayley was the only new one
    expect(summary.allowlistMatched).toBe(2); // both end up processed
    expect(summary.eventsProcessed).toBe(2);
  });

  it("per-venue feed failure does NOT fail the whole run", async () => {
    const summary = await runBoweryIngestion({
      prisma: makeIngestPrisma(),
      fetchBoweryFeed: vi.fn().mockResolvedValue(makeFeedResponse([rawEvent()])),
      fetchBoweryPerVenueFeed: vi.fn().mockRejectedValue(new Error("network nope")),
      now: () => fixedNow,
    });
    expect(summary.allowlistMatched).toBe(1);
    expect(summary.perVenueExtras).toBe(0);
    expect(summary.eventsProcessed).toBe(1);
  });

  it("per-venue defense in depth: rejects events whose venueId does not match the allowlist entry", async () => {
    // A misbehaving per-venue feed could return an event at a DIFFERENT
    // venue (124944 = Forest Hills allowlist; 99999 = unknown). We must
    // not merge it in just because it came from a per-venue fetch.
    const wrongVenue = rawEvent({
      eventId: "wrong_venue",
      venue: {
        venueId: "99999",
        title: "Some Other Place",
        city: "Brooklyn",
        state: "NY",
        address_line: null,
        timezone: "America/New_York",
      },
    });
    const summary = await runBoweryIngestion({
      prisma: makeIngestPrisma(),
      fetchBoweryFeed: vi.fn().mockResolvedValue(makeFeedResponse([])),
      fetchBoweryPerVenueFeed: vi.fn().mockResolvedValue(makeFeedResponse([wrongVenue])),
      now: () => fixedNow,
    });
    expect(summary.perVenueExtras).toBe(0);
    expect(summary.allowlistMatched).toBe(0);
  });

  it("returns feed etag + lastModified in summary for observability", async () => {
    const feed = makeFeedResponse([rawEvent()]);
    const summary = await runBoweryIngestion({
      prisma: makeIngestPrisma(),
      fetchBoweryFeed: vi.fn().mockResolvedValue(feed),
      fetchBoweryPerVenueFeed: vi.fn().mockResolvedValue({
        rawJson: { meta: { total: 0 }, events: [] },
        etag: null,
        lastModified: null,
      }),
      now: () => fixedNow,
      dryRun: true,
    });
    expect(summary.feedEtag).toBe('"fake-etag"');
    expect(summary.feedLastModified).toBe("Wed, 24 Jun 2026 11:00:00 GMT");
  });
});
