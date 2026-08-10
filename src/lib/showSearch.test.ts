import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchShows, MIN_SHOW_SEARCH_QUERY } from "./showSearch.js";

// Fixed "today" so distance-from-now assertions are deterministic.
const NOW = new Date("2026-08-10T00:00:00.000Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

/**
 * searchShows issues two queries — past (localDate <= now) then upcoming
 * (localDate > now). The mock dispatches on the where clause rather than
 * on call order, so the tests don't silently pass if the two are swapped.
 */
function makeMockPrisma(rows: { past?: unknown[]; upcoming?: unknown[] } = {}) {
  const findManyShows = vi.fn(async (args: any) => {
    const dateClause = args?.where?.AND?.[0]?.localDate ?? {};
    if ("lte" in dateClause) return rows.past ?? [];
    if ("gt" in dateClause) return rows.upcoming ?? [];
    return [];
  });
  return {
    prisma: {
      show: { findMany: findManyShows },
    } as unknown as import("@prisma/client").PrismaClient,
    mocks: { findManyShows },
  };
}

const stubRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "show1",
  localDate: day(-1),
  artist: { id: "a1", name: "The Beatles" },
  venue: { id: "v1", name: "Madison Square Garden", city: "New York" },
  _count: { reviews: 0, attendances: 0 },
  ...overrides,
});

const call = (mock: ReturnType<typeof makeMockPrisma>["mocks"], which: "past" | "upcoming") =>
  mock.findManyShows.mock.calls
    .map((c) => c[0] as any)
    .find((a) =>
      which === "past"
        ? "lte" in (a.where.AND[0].localDate ?? {})
        : "gt" in (a.where.AND[0].localDate ?? {}),
    );

describe("searchShows — input validation", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("returns empty for empty q without hitting the DB", async () => {
    const result = await searchShows({ q: "", limit: 20 }, { prisma: setup.prisma });
    expect(result).toEqual({ items: [] });
    expect(setup.mocks.findManyShows).not.toHaveBeenCalled();
  });

  it("returns empty for q shorter than minimum (1 char)", async () => {
    const result = await searchShows({ q: "a", limit: 20 }, { prisma: setup.prisma });
    expect(result).toEqual({ items: [] });
    expect(setup.mocks.findManyShows).not.toHaveBeenCalled();
  });

  it("accepts exactly minimum-length query (2 chars)", async () => {
    await searchShows({ q: "ab", limit: 20 }, { prisma: setup.prisma });
    expect(setup.mocks.findManyShows).toHaveBeenCalledTimes(2);
    expect(MIN_SHOW_SEARCH_QUERY).toBe(2);
  });

  it("trims whitespace before length check", async () => {
    await searchShows({ q: "  ab  " , limit: 20 }, { prisma: setup.prisma });
    expect(setup.mocks.findManyShows).toHaveBeenCalledTimes(2);

    const blank = makeMockPrisma();
    await searchShows({ q: "   ", limit: 20 }, { prisma: blank.prisma });
    expect(blank.mocks.findManyShows).not.toHaveBeenCalled();
  });
});

describe("searchShows — query shape", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(async () => {
    setup = makeMockPrisma();
    await searchShows({ q: "Beatles", limit: 20, now: NOW }, { prisma: setup.prisma });
  });

  it("matches artist.name, venue.name and venue.city case-insensitively on BOTH scans", async () => {
    for (const which of ["past", "upcoming"] as const) {
      const or = call(setup.mocks, which).where.AND[1].OR;
      expect(or).toContainEqual({
        artist: { name: { contains: "Beatles", mode: "insensitive" } },
      });
      expect(or).toContainEqual({
        venue: { name: { contains: "Beatles", mode: "insensitive" } },
      });
      expect(or).toContainEqual({
        venue: { city: { contains: "Beatles", mode: "insensitive" } },
      });
    }
  });

  it("scans backwards from today for past shows (localDate <= now, DESC)", () => {
    const past = call(setup.mocks, "past");
    expect(past.where.AND[0].localDate).toEqual({ lte: NOW });
    expect(past.orderBy).toEqual([{ localDate: "desc" }, { id: "desc" }]);
  });

  it("scans forwards from today for upcoming shows (localDate > now, ASC)", () => {
    const upcoming = call(setup.mocks, "upcoming");
    expect(upcoming.where.AND[0].localDate).toEqual({ gt: NOW });
    expect(upcoming.orderBy).toEqual([{ localDate: "asc" }, { id: "asc" }]);
  });

  it("takes limit from each side so one direction can fill the page alone", () => {
    expect(call(setup.mocks, "past").take).toBe(20);
    expect(call(setup.mocks, "upcoming").take).toBe(20);
  });

  it("filters BLOCKED reviews from the review _count aggregate", () => {
    const past = call(setup.mocks, "past");
    expect(past.include._count.select.reviews).toEqual({
      where: { moderationStatus: { not: "BLOCKED" } },
    });
    expect(past.include._count.select.attendances).toBe(true);
  });
});

describe("searchShows — ordering", () => {
  it("orders by distance from today, interleaving past and upcoming", async () => {
    const setup = makeMockPrisma({
      past: [
        stubRow({ id: "past1", localDate: day(-1) }),
        stubRow({ id: "past9", localDate: day(-9) }),
      ],
      upcoming: [
        stubRow({ id: "next3", localDate: day(3) }),
        stubRow({ id: "next20", localDate: day(20) }),
      ],
    });
    const result = await searchShows(
      { q: "beatles", limit: 20, now: NOW },
      { prisma: setup.prisma },
    );
    expect(result.items.map((i) => i.id)).toEqual([
      "past1",
      "next3",
      "past9",
      "next20",
    ]);
  });

  /**
   * The regression this rewrite exists for. Under the old `localDate DESC`
   * ordering a page full of far-future shows crowded out everything in the
   * past, so a recently-played show could not be found to review.
   */
  it("surfaces recent past shows even when far-future matches outnumber the limit", async () => {
    const setup = makeMockPrisma({
      past: [stubRow({ id: "yesterday", localDate: day(-1) })],
      upcoming: Array.from({ length: 20 }, (_, i) =>
        stubRow({ id: `future${i}`, localDate: day(200 + i) }),
      ),
    });
    const result = await searchShows(
      { q: "beatles", limit: 3, now: NOW },
      { prisma: setup.prisma },
    );
    expect(result.items[0]!.id).toBe("yesterday");
    expect(result.items.length).toBe(3);
  });

  it("fills the page from the past alone when there are no upcoming shows", async () => {
    const setup = makeMockPrisma({
      past: [
        stubRow({ id: "p1", localDate: day(-2) }),
        stubRow({ id: "p2", localDate: day(-30) }),
      ],
      upcoming: [],
    });
    const result = await searchShows(
      { q: "beatles", limit: 20, now: NOW },
      { prisma: setup.prisma },
    );
    expect(result.items.map((i) => i.id)).toEqual(["p1", "p2"]);
  });

  it("trims the merged set to limit", async () => {
    const setup = makeMockPrisma({
      past: [
        stubRow({ id: "p1", localDate: day(-1) }),
        stubRow({ id: "p2", localDate: day(-2) }),
      ],
      upcoming: [
        stubRow({ id: "u1", localDate: day(3) }),
        stubRow({ id: "u2", localDate: day(4) }),
      ],
    });
    const result = await searchShows(
      { q: "beatles", limit: 2, now: NOW },
      { prisma: setup.prisma },
    );
    expect(result.items.map((i) => i.id)).toEqual(["p1", "p2"]);
  });

  it("is deterministic when a past and an upcoming show are equidistant", async () => {
    const rows = {
      past: [stubRow({ id: "aaa", localDate: day(-5) })],
      upcoming: [stubRow({ id: "zzz", localDate: day(5) })],
    };
    const first = await searchShows(
      { q: "beatles", limit: 20, now: NOW },
      { prisma: makeMockPrisma(rows).prisma },
    );
    const second = await searchShows(
      { q: "beatles", limit: 20, now: NOW },
      { prisma: makeMockPrisma(rows).prisma },
    );
    expect(first.items.map((i) => i.id)).toEqual(second.items.map((i) => i.id));
  });
});

describe("searchShows — result shape", () => {
  it("maps DB rows to the public item shape, including counts", async () => {
    const setup = makeMockPrisma({
      past: [stubRow({ id: "s1", _count: { reviews: 3, attendances: 8 } })],
    });
    const result = await searchShows(
      { q: "beatles", limit: 20, now: NOW },
      { prisma: setup.prisma },
    );
    expect(result.items.length).toBe(1);
    expect(result.items[0]).toEqual({
      id: "s1",
      localDate: day(-1),
      artist: { id: "a1", name: "The Beatles" },
      venue: { id: "v1", name: "Madison Square Garden", city: "New York" },
      reviewCount: 3,
      attendanceCount: 8,
    });
  });

  it("no longer returns a cursor field", async () => {
    const setup = makeMockPrisma({ past: [stubRow()] });
    const result = await searchShows(
      { q: "beatles", limit: 20, now: NOW },
      { prisma: setup.prisma },
    );
    expect(result).not.toHaveProperty("nextCursor");
    expect(Object.keys(result)).toEqual(["items"]);
  });

  it("returns an empty item list when nothing matches", async () => {
    const setup = makeMockPrisma({ past: [], upcoming: [] });
    const result = await searchShows(
      { q: "xyzzynope", limit: 20, now: NOW },
      { prisma: setup.prisma },
    );
    expect(result).toEqual({ items: [] });
  });
});
