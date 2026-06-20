import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveArtist, resolveVenue } from "./showResolution.js";

function makeMockPrisma() {
  const findArtistUnique = vi.fn();
  const upsertArtist = vi.fn();
  const findVenueRefUnique = vi.fn();
  const upsertVenue = vi.fn();
  const upsertVenueRef = vi.fn().mockResolvedValue({});

  return {
    prisma: {
      artist: { findUnique: findArtistUnique, upsert: upsertArtist },
      venue: { upsert: upsertVenue },
      venueExternalRef: {
        findUnique: findVenueRefUnique,
        upsert: upsertVenueRef,
      },
    } as unknown as import("@prisma/client").PrismaClient,
    mocks: {
      findArtistUnique,
      upsertArtist,
      findVenueRefUnique,
      upsertVenue,
      upsertVenueRef,
    },
  };
}

// ---------------------------------------------------------------------------
// resolveArtist
// ---------------------------------------------------------------------------

describe("resolveArtist", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("with ticketmasterId that matches an existing Artist: returns it without name lookup", async () => {
    setup.mocks.findArtistUnique.mockResolvedValueOnce({
      id: "a_existing",
      name: "Fisher",
      ticketmasterId: "tm_artist_123",
    });
    const result = await resolveArtist(
      { name: "Fisher", ticketmasterId: "tm_artist_123" },
      { prisma: setup.prisma },
    );
    expect(result.id).toBe("a_existing");
    expect(setup.mocks.findArtistUnique).toHaveBeenCalledWith({
      where: { ticketmasterId: "tm_artist_123" },
      select: { id: true, name: true, ticketmasterId: true },
    });
    expect(setup.mocks.upsertArtist).not.toHaveBeenCalled();
  });

  it("with ticketmasterId, name variation: returns the row found by id, not by name (collapses variants)", async () => {
    // DB has name "Fisher"; incoming payload says "DJ Fisher" but same TM id.
    setup.mocks.findArtistUnique.mockResolvedValueOnce({
      id: "a_canonical",
      name: "Fisher",
      ticketmasterId: "tm_artist_123",
    });
    const result = await resolveArtist(
      { name: "DJ Fisher", ticketmasterId: "tm_artist_123" },
      { prisma: setup.prisma },
    );
    expect(result.name).toBe("Fisher"); // canonical name preserved
    expect(setup.mocks.upsertArtist).not.toHaveBeenCalled();
  });

  it("with ticketmasterId NOT in our DB: falls through to name upsert and stamps the ticketmasterId on the row", async () => {
    setup.mocks.findArtistUnique.mockResolvedValueOnce(null);
    setup.mocks.upsertArtist.mockResolvedValueOnce({
      id: "a_new",
      name: "Fisher",
      ticketmasterId: "tm_artist_new",
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
    });
    // Stamps the ticketmasterId on update too, so an existing
    // ticketmasterId-less row gets linked for next time.
    expect(call.update).toEqual({ ticketmasterId: "tm_artist_new" });
  });

  it("without ticketmasterId: pure name upsert, no findUnique call", async () => {
    setup.mocks.upsertArtist.mockResolvedValueOnce({
      id: "a_x",
      name: "Fisher",
      ticketmasterId: null,
    });
    await resolveArtist({ name: "Fisher" }, { prisma: setup.prisma });
    expect(setup.mocks.findArtistUnique).not.toHaveBeenCalled();
    const call = setup.mocks.upsertArtist.mock.calls[0]![0];
    expect(call.update).toEqual({});
    expect(call.create).toEqual({ name: "Fisher", ticketmasterId: null });
  });

  it("with explicitly null ticketmasterId: same as omitted", async () => {
    setup.mocks.upsertArtist.mockResolvedValueOnce({
      id: "a_y",
      name: "Fisher",
      ticketmasterId: null,
    });
    await resolveArtist(
      { name: "Fisher", ticketmasterId: null },
      { prisma: setup.prisma },
    );
    expect(setup.mocks.findArtistUnique).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// resolveVenue
// ---------------------------------------------------------------------------

describe("resolveVenue", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("with ticketmasterId that has a VenueExternalRef: returns the linked Venue without name+city lookup (the variant-name fix)", async () => {
    setup.mocks.findVenueRefUnique.mockResolvedValueOnce({
      venue: {
        id: "v_canonical",
        name: "Ocean Resort Casino - HQ2 Beachclub",
        city: "Atlantic City",
      },
    });
    // Note: incoming name is the VARIANT spelling. Returned name should be canonical.
    const result = await resolveVenue(
      {
        name: "Ocean Casino Resort - HQ2 Beachclub",
        city: "Atlantic City",
        ticketmasterId: "tm_venue_999",
      },
      { prisma: setup.prisma },
    );
    expect(result.id).toBe("v_canonical");
    expect(result.name).toBe("Ocean Resort Casino - HQ2 Beachclub");
    expect(setup.mocks.upsertVenue).not.toHaveBeenCalled();
    expect(setup.mocks.upsertVenueRef).not.toHaveBeenCalled();
  });

  it("with ticketmasterId NOT yet linked: falls through to name+city upsert, then stamps the ref", async () => {
    setup.mocks.findVenueRefUnique.mockResolvedValueOnce(null);
    setup.mocks.upsertVenue.mockResolvedValueOnce({
      id: "v_new",
      name: "Ocean Resort Casino - HQ2 Beachclub",
      city: "Atlantic City",
    });
    const result = await resolveVenue(
      {
        name: "Ocean Resort Casino - HQ2 Beachclub",
        city: "Atlantic City",
        ticketmasterId: "tm_venue_999",
      },
      { prisma: setup.prisma },
    );
    expect(result.id).toBe("v_new");
    // VenueExternalRef stamp happens
    expect(setup.mocks.upsertVenueRef).toHaveBeenCalledOnce();
    const refCall = setup.mocks.upsertVenueRef.mock.calls[0]![0];
    expect(refCall.where).toEqual({
      provider_providerVenueId: {
        provider: "ticketmaster",
        providerVenueId: "tm_venue_999",
      },
    });
    expect(refCall.create).toEqual({
      provider: "ticketmaster",
      providerVenueId: "tm_venue_999",
      venueId: "v_new",
    });
    // update is keyed by ref → in case the link existed under a different
    // venueId, we point it at the now-canonical venue. Acceptable
    // tradeoff: see notes in showResolution.ts.
    expect(refCall.update).toEqual({ venueId: "v_new" });
  });

  it("without ticketmasterId: pure name+city upsert, no ref lookup, no ref stamp", async () => {
    setup.mocks.upsertVenue.mockResolvedValueOnce({
      id: "v_no_tm",
      name: "Some Place",
      city: "Somewhere",
    });
    await resolveVenue(
      { name: "Some Place", city: "Somewhere" },
      { prisma: setup.prisma },
    );
    expect(setup.mocks.findVenueRefUnique).not.toHaveBeenCalled();
    expect(setup.mocks.upsertVenueRef).not.toHaveBeenCalled();
    const call = setup.mocks.upsertVenue.mock.calls[0]![0];
    expect(call.where).toEqual({
      name_city: { name: "Some Place", city: "Somewhere" },
    });
  });

  it("repeated calls with same ticketmasterId but different name spellings collapse onto one Venue (the actual variant-name regression test)", async () => {
    // First call: TM id not yet linked. Upsert venue + stamp ref.
    setup.mocks.findVenueRefUnique.mockResolvedValueOnce(null);
    setup.mocks.upsertVenue.mockResolvedValueOnce({
      id: "v_a",
      name: "Ocean Resort Casino - HQ2 Beachclub",
      city: "Atlantic City",
    });
    const r1 = await resolveVenue(
      {
        name: "Ocean Resort Casino - HQ2 Beachclub",
        city: "Atlantic City",
        ticketmasterId: "tm_v_77",
      },
      { prisma: setup.prisma },
    );

    // Second call comes in with the OTHER spelling but same TM id.
    // findVenueRefUnique should now return the link → venue resolves to v_a.
    setup = makeMockPrisma();
    setup.mocks.findVenueRefUnique.mockResolvedValueOnce({
      venue: {
        id: "v_a",
        name: "Ocean Resort Casino - HQ2 Beachclub",
        city: "Atlantic City",
      },
    });
    const r2 = await resolveVenue(
      {
        name: "Ocean Casino Resort - HQ2 Beachclub", // variant
        city: "Atlantic City",
        ticketmasterId: "tm_v_77",
      },
      { prisma: setup.prisma },
    );

    expect(r1.id).toBe("v_a");
    expect(r2.id).toBe("v_a");
    expect(setup.mocks.upsertVenue).not.toHaveBeenCalled(); // didn't create a 2nd venue
  });
});
