import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveArtist, resolveVenue } from "./showResolution.js";

function makeMockPrisma() {
  const findArtistUnique = vi.fn();
  const upsertArtist = vi.fn();
  const findVenueRefUnique = vi.fn();
  const upsertVenue = vi.fn();
  const upsertVenueRef = vi.fn().mockResolvedValue({});
  // Provider-neutral artist refs. Defaults to "no match" so the existing
  // legacy-column tests still exercise the fallback path they were
  // written for.
  const findArtistRefUnique = vi.fn().mockResolvedValue(null);
  const upsertArtistRef = vi.fn().mockResolvedValue({});

  return {
    prisma: {
      artist: { findUnique: findArtistUnique, upsert: upsertArtist },
      artistExternalRef: {
        findUnique: findArtistRefUnique,
        upsert: upsertArtistRef,
      },
      venue: { upsert: upsertVenue },
      venueExternalRef: {
        findUnique: findVenueRefUnique,
        upsert: upsertVenueRef,
      },
    } as unknown as import("@prisma/client").PrismaClient,
    mocks: {
      findArtistUnique,
      upsertArtist,
      findArtistRefUnique,
      upsertArtistRef,
      findVenueRefUnique,
      upsertVenue,
      upsertVenueRef,
    },
  };
}

const artistSelect = {
  id: true,
  name: true,
  ticketmasterId: true,
  diceId: true,
};

// ---------------------------------------------------------------------------
// resolveArtist — Ticketmaster path
// ---------------------------------------------------------------------------

describe("resolveArtist — Ticketmaster path", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("with ticketmasterId that matches: returns it without further lookup", async () => {
    setup.mocks.findArtistUnique.mockResolvedValueOnce({
      id: "a_existing",
      name: "Fisher",
      ticketmasterId: "tm_artist_123",
      diceId: null,
    });
    const result = await resolveArtist(
      { name: "Fisher", ticketmasterId: "tm_artist_123" },
      { prisma: setup.prisma },
    );
    expect(result.id).toBe("a_existing");
    expect(setup.mocks.findArtistUnique).toHaveBeenCalledWith({
      where: { ticketmasterId: "tm_artist_123" },
      select: artistSelect,
    });
    expect(setup.mocks.upsertArtist).not.toHaveBeenCalled();
  });

  it("with ticketmasterId, name variation: returns canonical row (collapses variants)", async () => {
    setup.mocks.findArtistUnique.mockResolvedValueOnce({
      id: "a_canonical",
      name: "Fisher",
      ticketmasterId: "tm_artist_123",
      diceId: null,
    });
    const result = await resolveArtist(
      { name: "DJ Fisher", ticketmasterId: "tm_artist_123" },
      { prisma: setup.prisma },
    );
    expect(result.name).toBe("Fisher");
    expect(setup.mocks.upsertArtist).not.toHaveBeenCalled();
  });

  it("with ticketmasterId not in DB: falls through to name upsert and stamps the id", async () => {
    setup.mocks.findArtistUnique.mockResolvedValueOnce(null);
    setup.mocks.upsertArtist.mockResolvedValueOnce({
      id: "a_new",
      name: "Fisher",
      ticketmasterId: "tm_artist_new",
      diceId: null,
    });
    const result = await resolveArtist(
      { name: "Fisher", ticketmasterId: "tm_artist_new" },
      { prisma: setup.prisma },
    );
    expect(result.id).toBe("a_new");
    const call = setup.mocks.upsertArtist.mock.calls[0]![0];
    expect(call.where).toEqual({ name: "Fisher" });
    expect(call.create).toEqual({
      name: "Fisher",
      ticketmasterId: "tm_artist_new",
      diceId: null,
    });
    expect(call.update).toEqual({ ticketmasterId: "tm_artist_new" });
  });
});

// ---------------------------------------------------------------------------
// resolveArtist — DICE path (new)
// ---------------------------------------------------------------------------

describe("resolveArtist — DICE path", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("with diceId that matches an existing Artist: returns it without name lookup", async () => {
    setup.mocks.findArtistUnique.mockResolvedValueOnce({
      id: "a_existing",
      name: "Elujay",
      ticketmasterId: null,
      diceId: "7v2lp",
    });
    const result = await resolveArtist(
      { name: "Elujay", diceId: "7v2lp" },
      { prisma: setup.prisma },
    );
    expect(result.id).toBe("a_existing");
    expect(setup.mocks.findArtistUnique).toHaveBeenCalledWith({
      where: { diceId: "7v2lp" },
      select: artistSelect,
    });
    expect(setup.mocks.upsertArtist).not.toHaveBeenCalled();
  });

  it("with diceId not in DB: falls through to name upsert and stamps the diceId", async () => {
    setup.mocks.findArtistUnique.mockResolvedValueOnce(null);
    setup.mocks.upsertArtist.mockResolvedValueOnce({
      id: "a_new",
      name: "Elujay",
      ticketmasterId: null,
      diceId: "7v2lp",
    });
    await resolveArtist(
      { name: "Elujay", diceId: "7v2lp" },
      { prisma: setup.prisma },
    );
    const call = setup.mocks.upsertArtist.mock.calls[0]![0];
    expect(call.create).toEqual({
      name: "Elujay",
      ticketmasterId: null,
      diceId: "7v2lp",
    });
    expect(call.update).toEqual({ diceId: "7v2lp" });
  });

  it("with BOTH ticketmasterId and diceId, TM matches: returns the TM-matched row (TM checked first)", async () => {
    setup.mocks.findArtistUnique.mockResolvedValueOnce({
      id: "a_via_tm",
      name: "Elujay",
      ticketmasterId: "tm_123",
      diceId: null,
    });
    const result = await resolveArtist(
      { name: "Elujay", ticketmasterId: "tm_123", diceId: "7v2lp" },
      { prisma: setup.prisma },
    );
    expect(result.id).toBe("a_via_tm");
    // Only one findUnique call (the TM one) — DICE check is skipped
    expect(setup.mocks.findArtistUnique).toHaveBeenCalledTimes(1);
    expect(setup.mocks.findArtistUnique).toHaveBeenCalledWith({
      where: { ticketmasterId: "tm_123" },
      select: artistSelect,
    });
  });

  it("with BOTH ids, TM misses but DICE matches: returns the DICE-matched row", async () => {
    setup.mocks.findArtistUnique.mockResolvedValueOnce(null); // TM lookup
    setup.mocks.findArtistUnique.mockResolvedValueOnce({
      id: "a_via_dice",
      name: "Elujay",
      ticketmasterId: null,
      diceId: "7v2lp",
    });
    const result = await resolveArtist(
      { name: "Elujay", ticketmasterId: "tm_unknown", diceId: "7v2lp" },
      { prisma: setup.prisma },
    );
    expect(result.id).toBe("a_via_dice");
    expect(setup.mocks.findArtistUnique).toHaveBeenCalledTimes(2);
  });

  it("with BOTH ids, neither matches: upsert stamps both", async () => {
    setup.mocks.findArtistUnique.mockResolvedValueOnce(null);
    setup.mocks.findArtistUnique.mockResolvedValueOnce(null);
    setup.mocks.upsertArtist.mockResolvedValueOnce({
      id: "a_new",
      name: "Elujay",
      ticketmasterId: "tm_x",
      diceId: "7v2lp",
    });
    await resolveArtist(
      { name: "Elujay", ticketmasterId: "tm_x", diceId: "7v2lp" },
      { prisma: setup.prisma },
    );
    const call = setup.mocks.upsertArtist.mock.calls[0]![0];
    expect(call.create).toEqual({
      name: "Elujay",
      ticketmasterId: "tm_x",
      diceId: "7v2lp",
    });
    expect(call.update).toEqual({
      ticketmasterId: "tm_x",
      diceId: "7v2lp",
    });
  });

  it("without any provider id: pure name upsert, no findUnique calls", async () => {
    setup.mocks.upsertArtist.mockResolvedValueOnce({
      id: "a_y",
      name: "Elujay",
      ticketmasterId: null,
      diceId: null,
    });
    await resolveArtist({ name: "Elujay" }, { prisma: setup.prisma });
    expect(setup.mocks.findArtistUnique).not.toHaveBeenCalled();
    const call = setup.mocks.upsertArtist.mock.calls[0]![0];
    expect(call.update).toEqual({});
    expect(call.create).toEqual({
      name: "Elujay",
      ticketmasterId: null,
      diceId: null,
    });
  });

  it("with explicitly null provider ids: same as omitted", async () => {
    setup.mocks.upsertArtist.mockResolvedValueOnce({
      id: "a_z",
      name: "Elujay",
      ticketmasterId: null,
      diceId: null,
    });
    await resolveArtist(
      { name: "Elujay", ticketmasterId: null, diceId: null },
      { prisma: setup.prisma },
    );
    expect(setup.mocks.findArtistUnique).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// resolveVenue — Ticketmaster path
// ---------------------------------------------------------------------------

describe("resolveVenue — Ticketmaster path", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("with ticketmasterId that has a VenueExternalRef: returns canonical Venue (variant-name fix)", async () => {
    setup.mocks.findVenueRefUnique.mockResolvedValueOnce({
      venue: {
        id: "v_canonical",
        name: "Ocean Resort Casino - HQ2 Beachclub",
        city: "Atlantic City",
      },
    });
    const result = await resolveVenue(
      {
        name: "Ocean Casino Resort - HQ2 Beachclub",
        city: "Atlantic City",
        ticketmasterId: "tm_venue_999",
      },
      { prisma: setup.prisma },
    );
    expect(result.id).toBe("v_canonical");
    expect(setup.mocks.upsertVenue).not.toHaveBeenCalled();
    expect(setup.mocks.upsertVenueRef).not.toHaveBeenCalled();
  });

  it("with ticketmasterId not yet linked: falls through to upsert, stamps ref", async () => {
    setup.mocks.findVenueRefUnique.mockResolvedValueOnce(null);
    setup.mocks.upsertVenue.mockResolvedValueOnce({
      id: "v_new",
      name: "Some Venue",
      city: "Anywhere",
    });
    await resolveVenue(
      {
        name: "Some Venue",
        city: "Anywhere",
        ticketmasterId: "tm_v_999",
      },
      { prisma: setup.prisma },
    );
    expect(setup.mocks.upsertVenueRef).toHaveBeenCalledOnce();
    const call = setup.mocks.upsertVenueRef.mock.calls[0]![0];
    expect(call.where.provider_providerVenueId.provider).toBe("ticketmaster");
    expect(call.where.provider_providerVenueId.providerVenueId).toBe("tm_v_999");
  });
});

// ---------------------------------------------------------------------------
// resolveVenue — DICE path (new) + multi-provider scenarios
// ---------------------------------------------------------------------------

describe("resolveVenue — DICE path", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("with diceId that has a VenueExternalRef: returns canonical Venue (sibling-room collapse)", async () => {
    // This is the Elsewhere case: 3 DICE records, 1 canonical Venue.
    setup.mocks.findVenueRefUnique.mockResolvedValueOnce({
      venue: {
        id: "v_elsewhere_canonical",
        name: "Elsewhere",
        city: "Brooklyn",
      },
    });
    const result = await resolveVenue(
      {
        // Incoming name is the sibling-room spelling
        name: "Elsewhere - The Hall",
        city: "Brooklyn",
        diceId: "6p32", // The Hall's DICE short id
      },
      { prisma: setup.prisma },
    );
    expect(result.id).toBe("v_elsewhere_canonical");
    expect(result.name).toBe("Elsewhere"); // canonical name preserved
    expect(setup.mocks.upsertVenue).not.toHaveBeenCalled();
    expect(setup.mocks.upsertVenueRef).not.toHaveBeenCalled();
  });

  it("with diceId not yet linked: falls through to upsert, stamps the DICE ref", async () => {
    setup.mocks.findVenueRefUnique.mockResolvedValueOnce(null);
    setup.mocks.upsertVenue.mockResolvedValueOnce({
      id: "v_new",
      name: "Elsewhere",
      city: "Brooklyn",
    });
    await resolveVenue(
      {
        name: "Elsewhere",
        city: "Brooklyn",
        diceId: "8p85",
      },
      { prisma: setup.prisma },
    );
    expect(setup.mocks.upsertVenueRef).toHaveBeenCalledOnce();
    const call = setup.mocks.upsertVenueRef.mock.calls[0]![0];
    expect(call.where).toEqual({
      provider_providerVenueId: {
        provider: "dice",
        providerVenueId: "8p85",
      },
    });
    expect(call.create).toEqual({
      provider: "dice",
      providerVenueId: "8p85",
      venueId: "v_new",
    });
  });

  it("with BOTH ticketmasterId and diceId: checks TM ref first, then DICE ref", async () => {
    setup.mocks.findVenueRefUnique.mockResolvedValueOnce(null); // TM ref miss
    setup.mocks.findVenueRefUnique.mockResolvedValueOnce({
      venue: { id: "v_dice", name: "Elsewhere", city: "Brooklyn" },
    });
    const result = await resolveVenue(
      {
        name: "Elsewhere",
        city: "Brooklyn",
        ticketmasterId: "tm_unknown",
        diceId: "8p85",
      },
      { prisma: setup.prisma },
    );
    expect(result.id).toBe("v_dice");
    expect(setup.mocks.findVenueRefUnique).toHaveBeenCalledTimes(2);
  });

  it("3 DICE records collapse to 1 Venue when seeded sequentially (sibling-room regression test)", async () => {
    // First call: DICE id 8p85 (Elsewhere main). No ref yet. Upsert venue + stamp ref.
    setup.mocks.findVenueRefUnique.mockResolvedValueOnce(null);
    setup.mocks.upsertVenue.mockResolvedValueOnce({
      id: "v_elsewhere",
      name: "Elsewhere",
      city: "Brooklyn",
    });
    const r1 = await resolveVenue(
      { name: "Elsewhere", city: "Brooklyn", diceId: "8p85" },
      { prisma: setup.prisma },
    );
    expect(r1.id).toBe("v_elsewhere");

    // Second call: DICE id 6p32 (Elsewhere - The Hall). Ref doesn't exist yet
    // (it's a different DICE short id). So the call falls through to the
    // (name, city) upsert which idempotently returns the same Venue, then
    // stamps a SECOND VenueExternalRef linking 6p32 to the same canonical
    // venue.
    setup = makeMockPrisma();
    setup.mocks.findVenueRefUnique.mockResolvedValueOnce(null);
    setup.mocks.upsertVenue.mockResolvedValueOnce({
      id: "v_elsewhere",
      name: "Elsewhere",
      city: "Brooklyn",
    });
    const r2 = await resolveVenue(
      { name: "Elsewhere", city: "Brooklyn", diceId: "6p32" },
      { prisma: setup.prisma },
    );
    expect(r2.id).toBe("v_elsewhere");
    const refCall = setup.mocks.upsertVenueRef.mock.calls[0]![0];
    expect(refCall.create.providerVenueId).toBe("6p32");
    expect(refCall.create.venueId).toBe("v_elsewhere");

    // Third call: DICE id a2bq (Elsewhere - Rooftop). Now BOTH prior refs
    // exist but neither matches a2bq. Falls through, returns same venue,
    // stamps third ref.
    setup = makeMockPrisma();
    setup.mocks.findVenueRefUnique.mockResolvedValueOnce(null);
    setup.mocks.upsertVenue.mockResolvedValueOnce({
      id: "v_elsewhere",
      name: "Elsewhere",
      city: "Brooklyn",
    });
    const r3 = await resolveVenue(
      { name: "Elsewhere", city: "Brooklyn", diceId: "a2bq" },
      { prisma: setup.prisma },
    );
    expect(r3.id).toBe("v_elsewhere");
  });

  it("without any provider id: pure name+city upsert, no ref lookups", async () => {
    setup.mocks.upsertVenue.mockResolvedValueOnce({
      id: "v_x",
      name: "Some Place",
      city: "Somewhere",
    });
    await resolveVenue(
      { name: "Some Place", city: "Somewhere" },
      { prisma: setup.prisma },
    );
    expect(setup.mocks.findVenueRefUnique).not.toHaveBeenCalled();
    expect(setup.mocks.upsertVenueRef).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// resolveArtist — provider-neutral external refs
// ---------------------------------------------------------------------------

describe("resolveArtist — provider-neutral externalIds", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("resolves via ArtistExternalRef without touching the name upsert", async () => {
    setup.mocks.findArtistRefUnique.mockResolvedValueOnce({
      artist: { id: "a1", name: "Beach House", ticketmasterId: null, diceId: null },
    });

    const result = await resolveArtist(
      { name: "BEACH HOUSE (variant spelling)", externalIds: [{ provider: "ticketmaster", id: "K8v1" }] },
      { prisma: setup.prisma },
    );

    expect(result.id).toBe("a1");
    // The whole point: a variant spelling collapses onto the canonical row.
    expect(result.name).toBe("Beach House");
    expect(setup.mocks.upsertArtist).not.toHaveBeenCalled();
  });

  it("stamps a ref when the artist is created by name", async () => {
    setup.mocks.upsertArtist.mockResolvedValueOnce({
      id: "a2", name: "New Artist", ticketmasterId: null, diceId: null,
    });

    await resolveArtist(
      { name: "New Artist", externalIds: [{ provider: "ticketmaster", id: "K8v2" }] },
      { prisma: setup.prisma },
    );

    expect(setup.mocks.upsertArtistRef).toHaveBeenCalledOnce();
    const call = setup.mocks.upsertArtistRef.mock.calls[0]![0];
    expect(call.create).toMatchObject({
      provider: "ticketmaster",
      providerArtistId: "K8v2",
      artistId: "a2",
    });
  });

  /**
   * The architectural guarantee: adding a provider must not require
   * editing this file. "axs" is not referenced anywhere in the source.
   */
  it("supports a provider the resolver has never heard of", async () => {
    setup.mocks.upsertArtist.mockResolvedValueOnce({
      id: "a3", name: "Some Band", ticketmasterId: null, diceId: null,
    });

    await resolveArtist(
      { name: "Some Band", externalIds: [{ provider: "axs", id: "axs-999" }] },
      { prisma: setup.prisma },
    );

    const call = setup.mocks.upsertArtistRef.mock.calls[0]![0];
    expect(call.create).toMatchObject({ provider: "axs", providerArtistId: "axs-999" });
    // and no legacy column was invented for it
    expect(setup.mocks.upsertArtist.mock.calls[0]![0].create).toMatchObject({
      ticketmasterId: null,
      diceId: null,
    });
  });

  it("de-duplicates a legacy id that is also passed as an externalId", async () => {
    setup.mocks.upsertArtist.mockResolvedValueOnce({
      id: "a4", name: "Dup", ticketmasterId: "K8v4", diceId: null,
    });

    await resolveArtist(
      { name: "Dup", ticketmasterId: "K8v4", externalIds: [{ provider: "ticketmaster", id: "K8v4" }] },
      { prisma: setup.prisma },
    );

    // one ref lookup, one ref write — not two of each
    expect(setup.mocks.findArtistRefUnique).toHaveBeenCalledOnce();
    expect(setup.mocks.upsertArtistRef).toHaveBeenCalledOnce();
  });
});
