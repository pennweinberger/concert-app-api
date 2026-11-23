import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  searchArtists,
  MIN_ARTIST_SEARCH_QUERY,
  DEFAULT_ARTIST_SEARCH_LIMIT,
} from "./artistSearch.js";

/**
 * searchArtists issues three queries — exact, prefix, substring. The mock
 * dispatches on WHICH name operator the where clause carries rather than
 * on call order, so these tests do not silently pass if the tiers are
 * reordered or one is dropped.
 */
type Tier = "exact" | "prefix" | "substring";

function tierOf(args: any): Tier | null {
  const name = args?.where?.AND?.[1]?.name ?? {};
  if ("equals" in name) return "exact";
  if ("startsWith" in name) return "prefix";
  if ("contains" in name) return "substring";
  return null;
}

function makeMockPrisma(rows: Partial<Record<Tier, unknown[]>> = {}) {
  const findManyArtists = vi.fn(async (args: any) => {
    const t = tierOf(args);
    return (t ? rows[t] : []) ?? [];
  });
  return {
    prisma: {
      artist: { findMany: findManyArtists },
    } as unknown as import("@prisma/client").PrismaClient,
    mocks: { findManyArtists },
  };
}

const argsFor = (
  mock: ReturnType<typeof makeMockPrisma>["mocks"],
  tier: Tier,
) =>
  mock.findManyArtists.mock.calls
    .map((c) => c[0] as any)
    .find((a) => tierOf(a) === tier);

const artist = (id: string, name: string) => ({ id, name });

describe("searchArtists — input validation", () => {
  it("returns nothing, and queries nothing, below the minimum length", async () => {
    const { prisma, mocks } = makeMockPrisma();
    const short = "x".repeat(MIN_ARTIST_SEARCH_QUERY - 1);
    const res = await searchArtists({ q: short, limit: 5 }, { prisma });
    expect(res.items).toEqual([]);
    expect(mocks.findManyArtists).not.toHaveBeenCalled();
  });

  it("trims before measuring, so whitespace is not a query", async () => {
    const { prisma, mocks } = makeMockPrisma();
    const res = await searchArtists({ q: "      ", limit: 5 }, { prisma });
    expect(res.items).toEqual([]);
    expect(mocks.findManyArtists).not.toHaveBeenCalled();
  });

  it("searches the trimmed term, not the raw input", async () => {
    const { prisma, mocks } = makeMockPrisma();
    await searchArtists({ q: "  lcd  ", limit: 5 }, { prisma });
    expect(argsFor(mocks, "exact").where.AND[1].name.equals).toBe("lcd");
  });
});

describe("searchArtists — market scope", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("constrains EVERY tier to artists with an in-market show", async () => {
    await searchArtists({ q: "lcd", limit: 5 }, { prisma: setup.prisma });
    const calls = setup.mocks.findManyArtists.mock.calls.map(
      (c) => c[0] as any,
    );
    expect(calls).toHaveLength(3);
    for (const a of calls) {
      expect(a.where.AND[0]).toEqual({
        shows: { some: { venue: { markets: { some: { market: { isActive: true } } } } } },
      });
    }
  });

  it("does not constrain on date — an artist whose only in-market shows are PAST still qualifies", async () => {
    await searchArtists({ q: "lcd", limit: 5 }, { prisma: setup.prisma });
    const serialized = JSON.stringify(
      setup.mocks.findManyArtists.mock.calls.map((c) => c[0]),
    );
    // A localDate bound anywhere in the where clause would silently drop
    // artists who have only ever played here in the past — exactly the
    // people whose pages are most reviewable.
    expect(serialized).not.toContain("localDate");
  });

  it("asks case-insensitively on every tier (Artist.name is still case-sensitively unique)", async () => {
    await searchArtists({ q: "lcd", limit: 5 }, { prisma: setup.prisma });
    for (const tier of ["exact", "prefix", "substring"] as Tier[]) {
      expect(argsFor(setup.mocks, tier).where.AND[1].name.mode).toBe(
        "insensitive",
      );
    }
  });
});

describe("searchArtists — ranking", () => {
  it("orders exact before prefix before substring", async () => {
    const { prisma } = makeMockPrisma({
      exact: [artist("a_exact", "LCD")],
      prefix: [artist("a_prefix", "LCD Soundsystem")],
      substring: [artist("a_sub", "The LCD Tribute")],
    });
    const res = await searchArtists({ q: "lcd", limit: 10 }, { prisma });
    expect(res.items.map((i) => i.id)).toEqual([
      "a_exact",
      "a_prefix",
      "a_sub",
    ]);
  });

  it("dedupes an artist that matches several tiers, keeping its best rank", async () => {
    const both = artist("a1", "LCD");
    const { prisma } = makeMockPrisma({
      // A real exact match also satisfies startsWith and contains, so the
      // same row comes back from all three queries.
      exact: [both],
      prefix: [both, artist("a2", "LCD Soundsystem")],
      substring: [both, artist("a2", "LCD Soundsystem")],
    });
    const res = await searchArtists({ q: "lcd", limit: 10 }, { prisma });
    expect(res.items.map((i) => i.id)).toEqual(["a1", "a2"]);
  });

  it("orders deterministically within a tier (name, then id)", async () => {
    await (async () => {
      const { prisma, mocks } = makeMockPrisma();
      await searchArtists({ q: "lcd", limit: 5 }, { prisma });
      expect(argsFor(mocks, "substring").orderBy).toEqual([
        { name: "asc" },
        { id: "asc" },
      ]);
    })();
  });
});

describe("searchArtists — limits and payload", () => {
  it("caps the merged result at the requested limit", async () => {
    const { prisma } = makeMockPrisma({
      exact: [artist("a1", "LCD")],
      prefix: [artist("a2", "LCD Two"), artist("a3", "LCD Three")],
      substring: [artist("a4", "Old LCD")],
    });
    const res = await searchArtists({ q: "lcd", limit: 2 }, { prisma });
    expect(res.items.map((i) => i.id)).toEqual(["a1", "a2"]);
  });

  it("bounds each individual query by the limit too", async () => {
    const { prisma, mocks } = makeMockPrisma();
    await searchArtists({ q: "lcd", limit: 3 }, { prisma });
    for (const a of mocks.findManyArtists.mock.calls.map((c) => c[0] as any)) {
      expect(a.take).toBe(3);
    }
  });

  it("selects and returns id + name ONLY", async () => {
    const { prisma, mocks } = makeMockPrisma({
      // Even if the row carried more, nothing extra may reach the caller.
      exact: [{ id: "a1", name: "LCD", mbid: "should-not-leak" }],
    });
    const res = await searchArtists({ q: "lcd", limit: 5 }, { prisma });
    expect(res.items).toEqual([{ id: "a1", name: "LCD" }]);
    expect(argsFor(mocks, "exact").select).toEqual({ id: true, name: true });
  });

  it("exposes a sane default limit", () => {
    expect(DEFAULT_ARTIST_SEARCH_LIMIT).toBeGreaterThan(0);
  });
});
