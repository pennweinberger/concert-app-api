import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isLegacyDiceEventId,
  isCurrentDiceEventId,
  diceReconcileKey,
  duplicateReconcileKeys,
  payloadMatchesEvent,
  reconcileDiceEvent,
} from "./diceReconcile.js";
import type { DiceMusicEvent } from "./diceParse.js";

const NEW_ID = "6a676db7233f7b0001480746";
const OLD_ID = "bb9k3k";
const VENUE = "venue_elsewhere";
const LOCAL_DATE = new Date("2026-10-02T00:00:00.000Z");

const event = (over: Partial<DiceMusicEvent> = {}): DiceMusicEvent => ({
  providerEventId: NEW_ID,
  url: `https://dice.fm/event/${NEW_ID}`,
  name: "Invented Act, Support",
  startDate: "2026-10-02T22:30:00-04:00",
  eventStatus: "https://schema.org/EventScheduled",
  locationName: "Elsewhere, Brooklyn",
  ...over,
});

/** A stored dice-minimal-v1 payload as the writer produces it. */
const stored = (over: Record<string, unknown> = {}) => ({
  _schema: "dice-minimal-v1",
  url: `https://dice.fm/event/${OLD_ID}-invented-act-tickets`,
  name: "Invented Act, Support",
  startDate: "2026-10-02T22:30:00-04:00",
  eventStatus: "https://schema.org/EventScheduled",
  locationName: "Elsewhere, Brooklyn",
  ...over,
});

function makePrisma(opts: {
  refs?: any[];
  reviews?: any[];
  alreadyLinked?: boolean;
  refUpdateError?: unknown;
}) {
  const findUniqueRef = vi.fn().mockResolvedValue(opts.alreadyLinked ? { id: "existing" } : null);
  const findManyRefs = vi.fn().mockResolvedValue(opts.refs ?? []);
  const updateRef = opts.refUpdateError
    ? vi.fn().mockRejectedValue(opts.refUpdateError)
    : vi.fn().mockResolvedValue({});
  const findManyReviews = vi.fn().mockResolvedValue(opts.reviews ?? []);
  const updateReview = vi.fn().mockResolvedValue({});
  return {
    prisma: {
      showExternalRef: { findUnique: findUniqueRef, findMany: findManyRefs, update: updateRef },
      providerMatchReview: { findMany: findManyReviews, update: updateReview },
    } as unknown as import("@prisma/client").PrismaClient,
    mocks: { findUniqueRef, findManyRefs, updateRef, findManyReviews, updateReview },
  };
}

const run = (setup: ReturnType<typeof makePrisma>, over: Partial<DiceMusicEvent> = {}, duplicateOnPage = false) =>
  reconcileDiceEvent(
    { event: event(over), canonicalVenueId: VENUE, localDate: LOCAL_DATE, duplicateOnPage },
    { prisma: setup.prisma },
  );

describe("id format helpers", () => {
  it("tells legacy and current ids apart", () => {
    expect(isLegacyDiceEventId("bb9k3k")).toBe(true);
    expect(isLegacyDiceEventId(NEW_ID)).toBe(false);
    expect(isCurrentDiceEventId(NEW_ID)).toBe(true);
    expect(isCurrentDiceEventId("bb9k3k")).toBe(false);
    // 24 chars but not hex, and an id of the wrong length
    expect(isCurrentDiceEventId("zzzzzzzzzzzzzzzzzzzzzzzz")).toBe(false);
    expect(isLegacyDiceEventId("bb9k3")).toBe(false);
  });
});

describe("reconcile key", () => {
  it("is the start instant and room, never the title", () => {
    const a = diceReconcileKey({ startDate: "2026-10-02T22:30:00-04:00", locationName: "Main" });
    const b = diceReconcileKey({ startDate: "2026-10-03T02:30:00Z", locationName: "Main" }); // same instant
    expect(a).toBe(b);
    expect(a).not.toBe(diceReconcileKey({ startDate: "2026-10-02T22:30:00-04:00", locationName: "Rooftop" }));
  });

  it("finds keys shared by two events on one page", () => {
    const dupes = duplicateReconcileKeys([
      { startDate: "2026-10-02T22:30:00-04:00", locationName: "Main" },
      { startDate: "2026-10-02T22:30:00-04:00", locationName: "Main" },
      { startDate: "2026-10-02T22:30:00-04:00", locationName: "Rooftop" },
    ]);
    expect(dupes.size).toBe(1);
    expect(dupes.has(diceReconcileKey({ startDate: "2026-10-02T22:30:00-04:00", locationName: "Main" }))).toBe(true);
  });
});

describe("payloadMatchesEvent", () => {
  it("matches on start instant and room", () => {
    expect(payloadMatchesEvent(stored(), event())).toBe(true);
    // Same instant written with a different offset still matches.
    expect(payloadMatchesEvent(stored({ startDate: "2026-10-03T02:30:00Z" }), event())).toBe(true);
  });

  it("ignores the title entirely", () => {
    expect(payloadMatchesEvent(stored({ name: "A completely different title" }), event())).toBe(true);
  });

  it("rejects a different time, room, or unusable payload", () => {
    expect(payloadMatchesEvent(stored({ startDate: "2026-10-02T23:00:00-04:00" }), event())).toBe(false);
    expect(payloadMatchesEvent(stored({ locationName: "Rooftop" }), event())).toBe(false);
    expect(payloadMatchesEvent(stored({ locationName: null }), event())).toBe(false);
    expect(payloadMatchesEvent(null, event())).toBe(false);
    expect(payloadMatchesEvent(stored({ startDate: "not a date" }), event())).toBe(false);
  });
});

describe("reconcileDiceEvent", () => {
  let setup: ReturnType<typeof makePrisma>;
  beforeEach(() => vi.clearAllMocks());

  it("re-keys the one matching legacy ref and keeps its Show", async () => {
    setup = makePrisma({
      refs: [{ id: "ref1", providerEventId: OLD_ID, showId: "show_1", rawPayload: stored() }],
    });
    const out = await run(setup);

    expect(out).toEqual({ kind: "rekeyed_ref", oldId: OLD_ID, newId: NEW_ID, showId: "show_1" });
    const call = setup.mocks.updateRef.mock.calls[0]![0];
    expect(call.where).toEqual({ id: "ref1" });
    expect(call.data.providerEventId).toBe(NEW_ID);
    // Same row, same Show: no second ref is created and showId is not touched.
    expect(call.data).not.toHaveProperty("showId");
    // Payload refreshed, still dice-minimal-v1 and still minimal.
    expect(Object.keys(call.data.rawPayload).sort()).toEqual(
      ["_schema", "eventStatus", "locationName", "name", "startDate", "url"].sort(),
    );
    expect(call.data.rawPayload._schema).toBe("dice-minimal-v1");
    // Scoped to this venue and date.
    expect(setup.mocks.findManyRefs.mock.calls[0]![0].where).toMatchObject({
      provider: "dice",
      show: { venueId: VENUE, localDate: LOCAL_DATE },
    });
  });

  /**
   * The case that would otherwise corrupt the catalog: DICE edited the
   * title, so the artist guessed from it differs and a duplicate Show
   * would be created. Venue, date, time and room are unchanged, so this
   * must reconcile to the SAME Show.
   */
  it("re-keys even when the title changed completely", async () => {
    setup = makePrisma({
      refs: [
        {
          id: "ref1",
          providerEventId: OLD_ID,
          showId: "show_1",
          rawPayload: stored({ name: "Old Promoter Title (was renamed)" }),
        },
      ],
    });
    const out = await run(setup, { name: "Brand New Headliner Name" });
    expect(out).toMatchObject({ kind: "rekeyed_ref", showId: "show_1" });
  });

  it("does not re-key when two legacy refs match", async () => {
    setup = makePrisma({
      refs: [
        { id: "ref1", providerEventId: "aaa111", showId: "show_1", rawPayload: stored() },
        { id: "ref2", providerEventId: "bbb222", showId: "show_2", rawPayload: stored() },
      ],
    });
    const out = await run(setup);
    expect(out).toEqual({ kind: "ambiguous", reason: "multiple_legacy_refs", candidates: 2 });
    expect(setup.mocks.updateRef).not.toHaveBeenCalled();
  });

  it("does not re-key when another event on the page shares the key", async () => {
    setup = makePrisma({
      refs: [{ id: "ref1", providerEventId: OLD_ID, showId: "show_1", rawPayload: stored() }],
    });
    const out = await run(setup, {}, true);
    expect(out).toMatchObject({ kind: "ambiguous", reason: "duplicate_event_key_on_page" });
    expect(setup.mocks.updateRef).not.toHaveBeenCalled();
    expect(setup.mocks.findManyRefs).not.toHaveBeenCalled();
  });

  it("does not re-key on a different start time or a different room", async () => {
    for (const payload of [stored({ startDate: "2026-10-02T23:59:00-04:00" }), stored({ locationName: "Rooftop" })]) {
      setup = makePrisma({ refs: [{ id: "ref1", providerEventId: OLD_ID, showId: "show_1", rawPayload: payload }] });
      expect(await run(setup)).toEqual({ kind: "no_match" });
      expect(setup.mocks.updateRef).not.toHaveBeenCalled();
    }
  });

  it("ignores refs that already use a current id", async () => {
    setup = makePrisma({
      refs: [{ id: "ref1", providerEventId: "89abcdef0123456789abcdef", showId: "show_1", rawPayload: stored() }],
    });
    expect(await run(setup)).toEqual({ kind: "no_match" });
  });

  it("skips events already linked under their current id", async () => {
    setup = makePrisma({ alreadyLinked: true });
    expect(await run(setup)).toEqual({ kind: "not_applicable" });
    expect(setup.mocks.findManyRefs).not.toHaveBeenCalled();
  });

  it("skips legacy-id events entirely", async () => {
    setup = makePrisma({});
    const out = await reconcileDiceEvent(
      {
        event: event({ providerEventId: "pyb9mp" }),
        canonicalVenueId: VENUE,
        localDate: LOCAL_DATE,
        duplicateOnPage: false,
      },
      { prisma: setup.prisma },
    );
    expect(out).toEqual({ kind: "not_applicable" });
    expect(setup.mocks.findUniqueRef).not.toHaveBeenCalled();
  });

  it("re-keys a matching review row and preserves its status", async () => {
    setup = makePrisma({
      reviews: [{ id: "pmr1", providerEventId: OLD_ID, rawPayload: stored() }],
    });
    const out = await run(setup);
    expect(out).toEqual({ kind: "rekeyed_review", oldId: OLD_ID, newId: NEW_ID, reviewId: "pmr1" });
    const call = setup.mocks.updateReview.mock.calls[0]![0];
    expect(call.data.providerEventId).toBe(NEW_ID);
    // A human's decision must survive the id change.
    expect(call.data).not.toHaveProperty("status");
    expect(call.data).not.toHaveProperty("reason");
    expect(call.data).not.toHaveProperty("candidateShowIds");
    expect(setup.mocks.findManyReviews.mock.calls[0]![0].where).toMatchObject({
      provider: "dice",
      resolvedVenueId: VENUE,
    });
  });

  it("does not re-key when two review rows match", async () => {
    setup = makePrisma({
      reviews: [
        { id: "pmr1", providerEventId: "aaa111", rawPayload: stored() },
        { id: "pmr2", providerEventId: "bbb222", rawPayload: stored() },
      ],
    });
    expect(await run(setup)).toMatchObject({ kind: "ambiguous", reason: "multiple_legacy_reviews" });
    expect(setup.mocks.updateReview).not.toHaveBeenCalled();
  });

  it("prefers a ref over a review when both match", async () => {
    setup = makePrisma({
      refs: [{ id: "ref1", providerEventId: OLD_ID, showId: "show_1", rawPayload: stored() }],
      reviews: [{ id: "pmr1", providerEventId: "aaa111", rawPayload: stored() }],
    });
    expect(await run(setup)).toMatchObject({ kind: "rekeyed_ref" });
    expect(setup.mocks.updateReview).not.toHaveBeenCalled();
  });

  it("reports a genuinely new event as no match", async () => {
    setup = makePrisma({ refs: [], reviews: [] });
    expect(await run(setup)).toEqual({ kind: "no_match" });
  });

  it("falls back to the normal path if the id was taken concurrently", async () => {
    setup = makePrisma({
      refs: [{ id: "ref1", providerEventId: OLD_ID, showId: "show_1", rawPayload: stored() }],
      refUpdateError: Object.assign(new Error("unique"), { code: "P2002" }),
    });
    expect(await run(setup)).toEqual({ kind: "no_match" });
  });

  it("rethrows unexpected database errors", async () => {
    setup = makePrisma({
      refs: [{ id: "ref1", providerEventId: OLD_ID, showId: "show_1", rawPayload: stored() }],
      refUpdateError: new Error("connection lost"),
    });
    await expect(run(setup)).rejects.toThrow("connection lost");
  });
});
