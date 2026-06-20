import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchShows, MIN_SHOW_SEARCH_QUERY } from "./showSearch.js";

function makeMockPrisma() {
  const findManyShows = vi.fn();
  return {
    prisma: {
      show: { findMany: findManyShows },
    } as unknown as import("@prisma/client").PrismaClient,
    mocks: { findManyShows },
  };
}

const stubRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "show1",
  localDate: new Date("2026-06-15T00:00:00.000Z"),
  artist: { id: "a1", name: "The Beatles" },
  venue: { id: "v1", name: "Madison Square Garden", city: "New York" },
  _count: { reviews: 0, attendances: 0 },
  ...overrides,
});

describe("searchShows — input validation", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("returns empty for empty q without hitting the DB", async () => {
    const result = await searchShows(
      { q: "", limit: 20, cursor: null },
      { prisma: setup.prisma },
    );
    expect(result).toEqual({ items: [], nextCursor: null });
    expect(setup.mocks.findManyShows).not.toHaveBeenCalled();
  });

  it("returns empty for q shorter than minimum (1 char)", async () => {
    const result = await searchShows(
      { q: "a", limit: 20, cursor: null },
      { prisma: setup.prisma },
    );
    expect(result).toEqual({ items: [], nextCursor: null });
    expect(setup.mocks.findManyShows).not.toHaveBeenCalled();
  });

  it("accepts exactly minimum-length query (2 chars)", async () => {
    setup.mocks.findManyShows.mockResolvedValueOnce([]);
    await searchShows(
      { q: "ab", limit: 20, cursor: null },
      { prisma: setup.prisma },
    );
    expect(setup.mocks.findManyShows).toHaveBeenCalledOnce();
    expect(MIN_SHOW_SEARCH_QUERY).toBe(2);
  });

  it("trims whitespace before length check", async () => {
    setup.mocks.findManyShows.mockResolvedValueOnce([]);
    await searchShows(
      { q: "  ab  ", limit: 20, cursor: null },
      { prisma: setup.prisma },
    );
    expect(setup.mocks.findManyShows).toHaveBeenCalledOnce();
    // Whitespace-only doesn't count
    setup = makeMockPrisma();
    await searchShows(
      { q: "   ", limit: 20, cursor: null },
      { prisma: setup.prisma },
    );
    expect(setup.mocks.findManyShows).not.toHaveBeenCalled();
  });
});

describe("searchShows — query shape", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
    setup.mocks.findManyShows.mockResolvedValueOnce([]);
  });

  it("issues case-insensitive contains on artist.name, venue.name, venue.city as an OR clause", async () => {
    await searchShows(
      { q: "Beatles", limit: 20, cursor: null },
      { prisma: setup.prisma },
    );
    const call = setup.mocks.findManyShows.mock.calls[0]![0];
    const andClause = call.where.AND;
    // Last element of AND is the OR clause
    const orClause = andClause[andClause.length - 1].OR;
    expect(orClause).toContainEqual({
      artist: { name: { contains: "Beatles", mode: "insensitive" } },
    });
    expect(orClause).toContainEqual({
      venue: { name: { contains: "Beatles", mode: "insensitive" } },
    });
    expect(orClause).toContainEqual({
      venue: { city: { contains: "Beatles", mode: "insensitive" } },
    });
  });

  it("orders by localDate DESC, id DESC for stable pagination", async () => {
    await searchShows(
      { q: "Beatles", limit: 20, cursor: null },
      { prisma: setup.prisma },
    );
    const call = setup.mocks.findManyShows.mock.calls[0]![0];
    expect(call.orderBy).toEqual([{ localDate: "desc" }, { id: "desc" }]);
  });

  it("requests limit+1 rows to detect 'has more'", async () => {
    await searchShows(
      { q: "Beatles", limit: 7, cursor: null },
      { prisma: setup.prisma },
    );
    const call = setup.mocks.findManyShows.mock.calls[0]![0];
    expect(call.take).toBe(8);
  });

  it("applies cursor as localDate < cursor when provided", async () => {
    const cursor = new Date("2026-04-01T00:00:00.000Z");
    await searchShows(
      { q: "Beatles", limit: 20, cursor },
      { prisma: setup.prisma },
    );
    const call = setup.mocks.findManyShows.mock.calls[0]![0];
    const cursorClause = call.where.AND[0];
    expect(cursorClause.localDate).toEqual({ lt: cursor });
  });

  it("filters BLOCKED reviews from the review _count aggregate", async () => {
    await searchShows(
      { q: "Beatles", limit: 20, cursor: null },
      { prisma: setup.prisma },
    );
    const call = setup.mocks.findManyShows.mock.calls[0]![0];
    expect(call.include._count.select.reviews).toEqual({
      where: { moderationStatus: { not: "BLOCKED" } },
    });
    expect(call.include._count.select.attendances).toBe(true);
  });
});

describe("searchShows — result shape", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("maps DB rows to the public item shape, including counts", async () => {
    setup.mocks.findManyShows.mockResolvedValueOnce([
      stubRow({
        id: "s1",
        _count: { reviews: 3, attendances: 8 },
      }),
    ]);
    const result = await searchShows(
      { q: "beatles", limit: 20, cursor: null },
      { prisma: setup.prisma },
    );
    expect(result.items.length).toBe(1);
    expect(result.items[0]).toEqual({
      id: "s1",
      localDate: new Date("2026-06-15T00:00:00.000Z"),
      artist: { id: "a1", name: "The Beatles" },
      venue: { id: "v1", name: "Madison Square Garden", city: "New York" },
      reviewCount: 3,
      attendanceCount: 8,
    });
    expect(result.nextCursor).toBeNull();
  });

  it("returns nextCursor when rows exceed limit", async () => {
    setup.mocks.findManyShows.mockResolvedValueOnce([
      stubRow({ id: "s1", localDate: new Date("2026-06-15T00:00:00.000Z") }),
      stubRow({ id: "s2", localDate: new Date("2026-05-01T00:00:00.000Z") }),
      stubRow({ id: "s3_overflow", localDate: new Date("2026-04-01T00:00:00.000Z") }),
    ]);
    const result = await searchShows(
      { q: "beatles", limit: 2, cursor: null },
      { prisma: setup.prisma },
    );
    expect(result.items.length).toBe(2);
    expect(result.items.map((i) => i.id)).toEqual(["s1", "s2"]);
    // nextCursor = last KEPT item's localDate
    expect(result.nextCursor).toBe("2026-05-01T00:00:00.000Z");
  });

  it("nextCursor is null when zero matches", async () => {
    setup.mocks.findManyShows.mockResolvedValueOnce([]);
    const result = await searchShows(
      { q: "xyzzynope", limit: 20, cursor: null },
      { prisma: setup.prisma },
    );
    expect(result).toEqual({ items: [], nextCursor: null });
  });
});
