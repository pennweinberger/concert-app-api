import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyDecision } from "./setlistfmIngest.js";
import type { MatchDecision } from "./providerMatch.js";
import type { SetlistfmSetlist } from "./setlistfm.js";

// Minimal payload fixture shared across tests.
const samplePayload: SetlistfmSetlist = {
  id: "slfm_event_abc123",
  eventDate: "15-07-2026", // dd-MM-yyyy → 2026-07-15
  artist: {
    mbid: "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d",
    name: "The Beatles",
  },
  venue: {
    id: "slfm_venue_xyz",
    name: "Madison Square Garden",
    city: { name: "New York", country: { code: "US", name: "United States" } },
  },
  url: "https://www.setlist.fm/setlist/abc123",
  sets: { set: [{ song: [{ name: "Hey Jude" }] }] },
};

const fixedNow = new Date("2026-06-14T20:00:00.000Z");
const expectedLocalDate = new Date("2026-07-15T00:00:00.000Z");

// Construct a vi-mocked Prisma client. We only mock the surface
// applyDecision touches.
function makeMockPrisma() {
  const showExternalRefUpsert = vi.fn().mockResolvedValue({});
  const setlistCacheUpsert = vi.fn().mockResolvedValue({});
  const providerMatchReviewUpsert = vi.fn().mockResolvedValue({});
  const artistCreate = vi.fn().mockResolvedValue({ id: "newly_created_artist" });
  const venueCreate = vi.fn().mockResolvedValue({ id: "newly_created_venue" });
  const showUpsert = vi
    .fn()
    .mockResolvedValue({ id: "newly_created_show" });
  const venueExternalRefUpsert = vi.fn().mockResolvedValue({});

  const tx = {
    showExternalRef: { upsert: showExternalRefUpsert },
    setlistCache: { upsert: setlistCacheUpsert },
    providerMatchReview: { upsert: providerMatchReviewUpsert },
    artist: { create: artistCreate },
    venue: { create: venueCreate },
    show: { upsert: showUpsert },
    venueExternalRef: { upsert: venueExternalRefUpsert },
  };

  const $transaction = vi.fn().mockImplementation(async (arg: unknown) => {
    // Two forms:
    //   - Array form: prisma resolves each operation
    //   - Callback form: invoke with the transaction client
    if (Array.isArray(arg)) {
      return Promise.all(arg);
    }
    if (typeof arg === "function") {
      return (arg as (t: typeof tx) => Promise<unknown>)(tx);
    }
    throw new Error("unexpected $transaction arg shape");
  });

  return {
    prisma: {
      ...tx,
      $transaction,
    } as unknown as import("@prisma/client").PrismaClient,
    mocks: {
      showExternalRefUpsert,
      setlistCacheUpsert,
      providerMatchReviewUpsert,
      artistCreate,
      venueCreate,
      showUpsert,
      venueExternalRefUpsert,
      $transaction,
    },
  };
}

function makeDeps(prisma: import("@prisma/client").PrismaClient) {
  return {
    prisma,
    searchSetlistsByArtistMbid: vi.fn(),
    now: () => fixedNow,
  };
}

describe("applyDecision — AUTO_MERGE", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("upserts ShowExternalRef and SetlistCache against the existing showId", async () => {
    const decision: MatchDecision = {
      action: "AUTO_MERGE",
      artistId: "a_existing",
      venueId: "v_existing",
      showId: "s_existing",
      candidateShowIds: [],
      reason: "exact",
    };

    await applyDecision(decision, samplePayload, makeDeps(setup.prisma));

    expect(setup.mocks.$transaction).toHaveBeenCalledOnce();
    expect(setup.mocks.showExternalRefUpsert).toHaveBeenCalledOnce();
    expect(setup.mocks.setlistCacheUpsert).toHaveBeenCalledOnce();

    // No artist/venue/show/venueRef creation in AUTO_MERGE
    expect(setup.mocks.artistCreate).not.toHaveBeenCalled();
    expect(setup.mocks.venueCreate).not.toHaveBeenCalled();
    expect(setup.mocks.showUpsert).not.toHaveBeenCalled();
    expect(setup.mocks.venueExternalRefUpsert).not.toHaveBeenCalled();

    const refCall = setup.mocks.showExternalRefUpsert.mock.calls[0]![0];
    expect(refCall.where).toEqual({
      provider_providerEventId: {
        provider: "setlistfm",
        providerEventId: "slfm_event_abc123",
      },
    });
    expect(refCall.create).toMatchObject({
      showId: "s_existing",
      provider: "setlistfm",
      providerEventId: "slfm_event_abc123",
    });

    const cacheCall = setup.mocks.setlistCacheUpsert.mock.calls[0]![0];
    expect(cacheCall.where).toEqual({ showId: "s_existing" });
    expect(cacheCall.create).toMatchObject({
      showId: "s_existing",
      status: "fetched",
      sourceUrl: "https://www.setlist.fm/setlist/abc123",
      fetchedAt: fixedNow,
    });
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
      applyDecision(decision, samplePayload, makeDeps(setup.prisma))
    ).rejects.toThrow(/AUTO_MERGE without showId/);
  });
});

describe("applyDecision — REVIEW", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("upserts ProviderMatchReview with the provider event id as the idempotency key", async () => {
    const decision: MatchDecision = {
      action: "REVIEW",
      artistId: "a_known",
      venueId: null,
      showId: null,
      candidateShowIds: ["s_candidate_1"],
      reason: "artist:mbid_match|venue:no_venue_match|show:no_show_match",
    };

    await applyDecision(decision, samplePayload, makeDeps(setup.prisma));

    expect(setup.mocks.providerMatchReviewUpsert).toHaveBeenCalledOnce();
    expect(setup.mocks.$transaction).not.toHaveBeenCalled();

    const call = setup.mocks.providerMatchReviewUpsert.mock.calls[0]![0];
    expect(call.where).toEqual({
      provider_providerEventId: {
        provider: "setlistfm",
        providerEventId: "slfm_event_abc123",
      },
    });
    expect(call.create).toMatchObject({
      provider: "setlistfm",
      providerEventId: "slfm_event_abc123",
      resolvedArtistId: "a_known",
      resolvedVenueId: null,
      candidateShowIds: ["s_candidate_1"],
      reason: "artist:mbid_match|venue:no_venue_match|show:no_show_match",
      status: "pending",
    });

    // No Show / ShowExternalRef / VenueExternalRef writes in REVIEW
    expect(setup.mocks.showExternalRefUpsert).not.toHaveBeenCalled();
    expect(setup.mocks.setlistCacheUpsert).not.toHaveBeenCalled();
    expect(setup.mocks.artistCreate).not.toHaveBeenCalled();
    expect(setup.mocks.venueCreate).not.toHaveBeenCalled();
    expect(setup.mocks.showUpsert).not.toHaveBeenCalled();
    expect(setup.mocks.venueExternalRefUpsert).not.toHaveBeenCalled();
  });
});

describe("applyDecision — CREATE_NEW", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("when artist is NEW and venue is NEW: creates both, upserts show, refs, cache", async () => {
    const decision: MatchDecision = {
      action: "CREATE_NEW",
      artistId: null, // → must be created
      venueId: null, // → must be created
      showId: null,
      candidateShowIds: [],
      reason: "all_new",
    };

    await applyDecision(decision, samplePayload, makeDeps(setup.prisma));

    expect(setup.mocks.$transaction).toHaveBeenCalledOnce();
    expect(setup.mocks.artistCreate).toHaveBeenCalledOnce();
    expect(setup.mocks.venueCreate).toHaveBeenCalledOnce();
    expect(setup.mocks.showUpsert).toHaveBeenCalledOnce();
    expect(setup.mocks.showExternalRefUpsert).toHaveBeenCalledOnce();
    expect(setup.mocks.venueExternalRefUpsert).toHaveBeenCalledOnce();
    expect(setup.mocks.setlistCacheUpsert).toHaveBeenCalledOnce();
    expect(setup.mocks.providerMatchReviewUpsert).not.toHaveBeenCalled();

    const artistCall = setup.mocks.artistCreate.mock.calls[0]![0];
    expect(artistCall.data).toMatchObject({
      name: "The Beatles",
      mbid: "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d",
      mbidConfidence: 0.95,
    });

    const venueCall = setup.mocks.venueCreate.mock.calls[0]![0];
    expect(venueCall.data).toMatchObject({
      name: "Madison Square Garden",
      city: "New York",
      country: "US",
    });

    const showCall = setup.mocks.showUpsert.mock.calls[0]![0];
    expect(showCall.where).toEqual({
      artistId_venueId_localDate: {
        artistId: "newly_created_artist",
        venueId: "newly_created_venue",
        localDate: expectedLocalDate,
      },
    });
    expect(showCall.create).toMatchObject({
      artistId: "newly_created_artist",
      venueId: "newly_created_venue",
      localDate: expectedLocalDate,
    });

    const refCall = setup.mocks.showExternalRefUpsert.mock.calls[0]![0];
    expect(refCall.create).toMatchObject({
      showId: "newly_created_show",
      provider: "setlistfm",
      providerEventId: "slfm_event_abc123",
    });

    const venueRefCall = setup.mocks.venueExternalRefUpsert.mock.calls[0]![0];
    expect(venueRefCall.where).toEqual({
      provider_providerVenueId: {
        provider: "setlistfm",
        providerVenueId: "slfm_venue_xyz",
      },
    });
    expect(venueRefCall.create).toMatchObject({
      venueId: "newly_created_venue",
      provider: "setlistfm",
      providerVenueId: "slfm_venue_xyz",
    });

    const cacheCall = setup.mocks.setlistCacheUpsert.mock.calls[0]![0];
    expect(cacheCall.where).toEqual({ showId: "newly_created_show" });
    expect(cacheCall.create).toMatchObject({
      showId: "newly_created_show",
      status: "fetched",
      sourceUrl: "https://www.setlist.fm/setlist/abc123",
      fetchedAt: fixedNow,
    });
  });

  it("when artist EXACT and venue NEW: skips artist create, creates venue, creates show under existing artist", async () => {
    const decision: MatchDecision = {
      action: "CREATE_NEW",
      artistId: "a_existing",
      venueId: null,
      showId: null,
      candidateShowIds: [],
      reason: "venue_only_new",
    };

    await applyDecision(decision, samplePayload, makeDeps(setup.prisma));

    expect(setup.mocks.artistCreate).not.toHaveBeenCalled();
    expect(setup.mocks.venueCreate).toHaveBeenCalledOnce();

    const showCall = setup.mocks.showUpsert.mock.calls[0]![0];
    expect(showCall.create.artistId).toBe("a_existing");
    expect(showCall.create.venueId).toBe("newly_created_venue");
  });

  it("when artist EXACT and venue EXACT: skips both creates, just attaches show + refs + cache", async () => {
    const decision: MatchDecision = {
      action: "CREATE_NEW",
      artistId: "a_existing",
      venueId: "v_existing",
      showId: null,
      candidateShowIds: [],
      reason: "show_only_new",
    };

    await applyDecision(decision, samplePayload, makeDeps(setup.prisma));

    expect(setup.mocks.artistCreate).not.toHaveBeenCalled();
    expect(setup.mocks.venueCreate).not.toHaveBeenCalled();
    expect(setup.mocks.showUpsert).toHaveBeenCalledOnce();

    const showCall = setup.mocks.showUpsert.mock.calls[0]![0];
    expect(showCall.create.artistId).toBe("a_existing");
    expect(showCall.create.venueId).toBe("v_existing");

    // VenueExternalRef still gets upserted (idempotent — captures the
    // setlist.fm venue id → existing venue mapping if it wasn't already)
    expect(setup.mocks.venueExternalRefUpsert).toHaveBeenCalledOnce();
    expect(setup.mocks.venueExternalRefUpsert.mock.calls[0]![0].create.venueId).toBe(
      "v_existing"
    );
  });
});
