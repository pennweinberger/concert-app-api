import { describe, it, expect, vi, beforeEach } from "vitest";
import { ingestNormalizedEvents } from "./ingestEngine.js";
import type { NormalizedEvent } from "./ingestTypes.js";

const DATE = new Date("2026-09-02T00:00:00.000Z");

function evt(over: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    provider: "ticketmaster",
    providerEventId: "tm_1",
    artist: { name: "Beach House", providerId: "K8vZ1" },
    venue: { name: "Brooklyn Steel", city: "Brooklyn", providerId: "KovZ1" },
    startDatetimeUtc: new Date("2026-09-03T00:00:00.000Z"),
    localDate: DATE,
    status: "scheduled",
    raw: { id: "tm_1" },
    ...over,
  };
}

function makeMockPrisma(opts: {
  existingRefs?: any[];
  existingShow?: any;
  artists?: any[];
  venues?: any[];
} = {}) {
  const showExternalRefFindMany = vi.fn().mockResolvedValue(opts.existingRefs ?? []);
  const showExternalRefUpsert = vi.fn().mockResolvedValue({ id: "ref_new" });
  const showExternalRefUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
  const showFindUnique = vi.fn().mockResolvedValue(opts.existingShow ?? null);
  const showCreate = vi.fn().mockResolvedValue({ id: "show_new" });
  const showUpdate = vi.fn().mockResolvedValue({});
  const artistFindMany = vi.fn().mockResolvedValue(opts.artists ?? []);
  const venueFindMany = vi.fn().mockResolvedValue(opts.venues ?? []);
  const artistUpsert = vi.fn().mockResolvedValue({
    id: "artist_1", name: "Beach House", ticketmasterId: null, diceId: null,
  });
  const venueUpsert = vi.fn().mockResolvedValue({
    id: "venue_1", name: "Brooklyn Steel", city: "Brooklyn",
  });
  const reviewUpsert = vi.fn().mockResolvedValue({});

  const prisma = {
    showExternalRef: {
      findMany: showExternalRefFindMany,
      upsert: showExternalRefUpsert,
      updateMany: showExternalRefUpdateMany,
    },
    show: { findUnique: showFindUnique, create: showCreate, update: showUpdate },
    artist: { findMany: artistFindMany, findUnique: vi.fn().mockResolvedValue(null), upsert: artistUpsert },
    artistExternalRef: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
    venue: { findMany: venueFindMany, upsert: venueUpsert },
    venueExternalRef: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
    providerMatchReview: { upsert: reviewUpsert },
  } as unknown as import("@prisma/client").PrismaClient;

  return {
    prisma,
    mocks: {
      showExternalRefFindMany, showExternalRefUpsert, showExternalRefUpdateMany,
      showFindUnique, showCreate, showUpdate, artistUpsert, venueUpsert, reviewUpsert,
    },
  };
}

describe("ingestEngine — validation and batch hygiene", () => {
  it("counts an empty batch without touching the DB", async () => {
    const s = makeMockPrisma();
    const r = await ingestNormalizedEvents([], { prisma: s.prisma });
    expect(r.fetched).toBe(0);
    expect(s.mocks.showExternalRefFindMany).not.toHaveBeenCalled();
  });

  it("drops duplicate providerEventIds inside one batch", async () => {
    const s = makeMockPrisma();
    const r = await ingestNormalizedEvents([evt(), evt()], { prisma: s.prisma });
    expect(r.skipped.duplicateInBatch).toBe(1);
    expect(r.created).toBe(1);
  });

  it("skips events with no artist rather than inventing one", async () => {
    const s = makeMockPrisma();
    const r = await ingestNormalizedEvents(
      [evt({ artist: { name: "", providerId: null } })],
      { prisma: s.prisma },
    );
    expect(r.skipped.missingArtist).toBe(1);
    expect(s.mocks.showCreate).not.toHaveBeenCalled();
  });

  it("skips events with an unusable date", async () => {
    const s = makeMockPrisma();
    const r = await ingestNormalizedEvents(
      [evt({ localDate: new Date("nope") })],
      { prisma: s.prisma },
    );
    expect(r.skipped.invalidDate).toBe(1);
  });

  it("uses ONE batched query for idempotency, not one per event", async () => {
    const s = makeMockPrisma();
    await ingestNormalizedEvents(
      [evt({ providerEventId: "a" }), evt({ providerEventId: "b" }), evt({ providerEventId: "c" })],
      { prisma: s.prisma },
    );
    expect(s.mocks.showExternalRefFindMany).toHaveBeenCalledOnce();
  });
});

describe("ingestEngine — idempotency", () => {
  it("re-running an unchanged event creates nothing", async () => {
    const s = makeMockPrisma({
      existingRefs: [{
        id: "ref_1", providerEventId: "tm_1", showId: "show_1",
        show: { id: "show_1", status: "scheduled", startDatetimeUtc: new Date("2026-09-03T00:00:00.000Z") },
      }],
    });
    const r = await ingestNormalizedEvents([evt()], { prisma: s.prisma });
    expect(r.skipped.unchanged).toBe(1);
    expect(r.created).toBe(0);
    expect(s.mocks.showCreate).not.toHaveBeenCalled();
    expect(s.mocks.showUpdate).not.toHaveBeenCalled();
  });

  it("still refreshes lastSeenAt for unchanged events", async () => {
    const s = makeMockPrisma({
      existingRefs: [{
        id: "ref_1", providerEventId: "tm_1", showId: "show_1",
        show: { id: "show_1", status: "scheduled", startDatetimeUtc: new Date("2026-09-03T00:00:00.000Z") },
      }],
    });
    await ingestNormalizedEvents([evt()], { prisma: s.prisma });
    expect(s.mocks.showExternalRefUpdateMany).toHaveBeenCalledOnce();
  });
});

describe("ingestEngine — status changes", () => {
  it("applies an explicit cancellation to an existing show", async () => {
    const s = makeMockPrisma({
      existingRefs: [{
        id: "ref_1", providerEventId: "tm_1", showId: "show_1",
        show: { id: "show_1", status: "scheduled", startDatetimeUtc: new Date("2026-09-03T00:00:00.000Z") },
      }],
    });
    const r = await ingestNormalizedEvents([evt({ status: "cancelled" })], { prisma: s.prisma });
    expect(r.updated).toBe(1);
    expect(s.mocks.showUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }),
    );
  });

  /**
   * Regression: providers list one show under several event ids whose
   * start times disagree. Accepting every difference made each listing
   * overwrite the other, so every run reported updates forever.
   */
  it("ignores a bare time difference — that is not a reschedule", async () => {
    const s = makeMockPrisma({
      existingRefs: [{
        id: "ref_1", providerEventId: "tm_1", showId: "show_1",
        show: { id: "show_1", status: "scheduled", startDatetimeUtc: new Date("2026-09-03T00:00:00.000Z") },
      }],
    });
    const r = await ingestNormalizedEvents(
      [evt({ status: "scheduled", startDatetimeUtc: new Date("2026-09-03T03:00:00.000Z") })],
      { prisma: s.prisma },
    );
    expect(r.updated).toBe(0);
    expect(r.skipped.unchanged).toBe(1);
    expect(s.mocks.showUpdate).not.toHaveBeenCalled();
  });

  it("fills in a time when the show was created without one", async () => {
    const s = makeMockPrisma({
      existingRefs: [{
        id: "ref_1", providerEventId: "tm_1", showId: "show_1",
        // startDatetimeUtc == localDate means we never had a clock time
        show: { id: "show_1", status: "scheduled", startDatetimeUtc: DATE },
      }],
    });
    const r = await ingestNormalizedEvents(
      [evt({ startDatetimeUtc: new Date("2026-09-02T23:00:00.000Z") })],
      { prisma: s.prisma },
    );
    expect(r.updated).toBe(1);
  });

  it("applies a rescheduled start time", async () => {
    const s = makeMockPrisma({
      existingRefs: [{
        id: "ref_1", providerEventId: "tm_1", showId: "show_1",
        show: { id: "show_1", status: "scheduled", startDatetimeUtc: new Date("2026-09-03T00:00:00.000Z") },
      }],
    });
    const r = await ingestNormalizedEvents(
      [evt({ status: "rescheduled", startDatetimeUtc: new Date("2026-09-04T01:00:00.000Z") })],
      { prisma: s.prisma },
    );
    expect(r.updated).toBe(1);
  });

  /** The rule that protects historical data: absence is not a signal. */
  it("never deletes or cancels anything for events simply absent from the batch", async () => {
    const s = makeMockPrisma();
    await ingestNormalizedEvents([evt({ providerEventId: "only_this_one" })], { prisma: s.prisma });
    expect((s.prisma as any).show.delete).toBeUndefined();
    // the only status write path is an explicit provider status
    expect(s.mocks.showUpdate).not.toHaveBeenCalled();
  });
});

describe("ingestEngine — cross-provider matching", () => {
  it("links to an existing Show instead of creating a duplicate", async () => {
    const s = makeMockPrisma({ existingShow: { id: "show_from_dice", status: "scheduled" } });
    const r = await ingestNormalizedEvents([evt()], { prisma: s.prisma });
    expect(r.matched).toBe(1);
    expect(r.created).toBe(0);
    expect(s.mocks.showCreate).not.toHaveBeenCalled();
    // and the Ticketmaster ref now points at the DICE-created show
    expect(s.mocks.showExternalRefUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ showId: "show_from_dice" }) }),
    );
  });

  it("resolves a venue once for a multi-night residency", async () => {
    const s = makeMockPrisma();
    await ingestNormalizedEvents(
      [
        evt({ providerEventId: "n1", localDate: new Date("2026-09-02T00:00:00.000Z") }),
        evt({ providerEventId: "n2", localDate: new Date("2026-09-03T00:00:00.000Z") }),
        evt({ providerEventId: "n3", localDate: new Date("2026-09-04T00:00:00.000Z") }),
      ],
      { prisma: s.prisma },
    );
    // memoised — one venue upsert for three nights (connection_limit=1)
    expect(s.mocks.venueUpsert).toHaveBeenCalledOnce();
    expect(s.mocks.artistUpsert).toHaveBeenCalledOnce();
  });
});

describe("ingestEngine — write budget", () => {
  it("stops cleanly at the budget and reports it", async () => {
    const s = makeMockPrisma();
    const r = await ingestNormalizedEvents(
      [evt({ providerEventId: "a" }), evt({ providerEventId: "b" }), evt({ providerEventId: "c" })],
      { prisma: s.prisma, maxWrites: 2 },
    );
    expect(r.created).toBe(2);
    expect(r.skipped.writeBudgetReached).toBe(1);
    expect(r.budgetExhausted).toBe(true);
  });
});

describe("ingestEngine — resilience", () => {
  it("counts a failing event and keeps processing the rest", async () => {
    const s = makeMockPrisma();
    (s.mocks.showCreate as any)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ id: "show_ok" });
    const r = await ingestNormalizedEvents(
      [evt({ providerEventId: "bad" }), evt({ providerEventId: "good", artist: { name: "Other", providerId: "K2" } })],
      { prisma: s.prisma },
    );
    expect(r.errors).toBe(1);
    expect(r.created).toBe(1);
  });
});

describe("ingestEngine — wall-clock deadline", () => {
  it("stops starting work once the deadline passes", async () => {
    const s = makeMockPrisma();
    let t = 1_000_000;
    // Each call to now() advances 1s, mimicking slow cross-region writes.
    const now = () => new Date((t += 1000));
    const r = await ingestNormalizedEvents(
      [
        evt({ providerEventId: "a" }),
        evt({ providerEventId: "b" }),
        evt({ providerEventId: "c" }),
      ],
      { prisma: s.prisma, now, deadline: new Date(1_000_000 + 2500) },
    );
    // Some work happened, then the run ended cleanly rather than being killed.
    expect(r.budgetExhausted).toBe(true);
    expect(r.created).toBeLessThan(3);
    expect(r.skipped.writeBudgetReached).toBeGreaterThan(0);
  });

  it("runs everything when no deadline is given", async () => {
    const s = makeMockPrisma();
    const r = await ingestNormalizedEvents(
      [evt({ providerEventId: "a" }), evt({ providerEventId: "b" })],
      { prisma: s.prisma },
    );
    expect(r.created).toBe(2);
    expect(r.budgetExhausted).toBeUndefined();
  });
});
