import { describe, it, expect } from "vitest";
import {
  inspectDiceVenuePage,
  evaluateDiceRunHealth,
  assertDiceRunHealthy,
  DiceIngestHealthError,
  MIN_ACTIVE_VENUES_FOR_ZERO_YIELD_ALERT,
} from "./diceHealth.js";
import { parseDiceVenuePage } from "./diceParse.js";

// Synthetic pages. Event names and ids are invented; they only mimic the
// SHAPE of DICE's JSON-LD before and after the September 2026 change.
const page = (events: unknown[], extra: Record<string, unknown> = {}) =>
  `<html><head>
<script type="application/ld+json">${JSON.stringify({ "@type": "Brand", name: "DICE" })}</script>
<script type="application/ld+json">${JSON.stringify({
    "@type": "Place",
    name: "Test Room, Brooklyn",
    address: "1 Test St, Brooklyn, NY 11211, USA",
    event: events,
    ...extra,
  })}</script></head></html>`;

const newFormatEvent = (i: number) => ({
  "@type": "Event",
  url: `https://dice.fm/event/${"0123456789abcdef01234567".slice(0, 23)}${i}`,
  name: `Invented Act ${i}`,
  startDate: "2026-10-02T22:30:00-04:00",
  eventStatus: "https://schema.org/EventScheduled",
  location: { "@type": "Place", name: "Test Room, Brooklyn" },
});

const legacyEvent = (i: number) => ({
  "@type": "MusicEvent",
  url: `https://dice.fm/event/abc12${i}-invented-act-tickets`,
  name: `Invented Act ${i}`,
  startDate: "2026-10-02T22:30:00-04:00",
  location: { "@type": "Place", name: "Test Room, Brooklyn" },
});

describe("inspectDiceVenuePage", () => {
  it("counts listed events and their types without filtering", () => {
    const stats = inspectDiceVenuePage(page([newFormatEvent(1), newFormatEvent(2)]));
    expect(stats).toEqual({ placeFound: true, rawEventCount: 2, rawEventTypes: ["Event"] });
  });

  it("reports a genuinely empty venue as zero listed events, not drift", () => {
    expect(inspectDiceVenuePage(page([]))).toEqual({
      placeFound: true,
      rawEventCount: 0,
      rawEventTypes: [],
    });
  });

  it("reports a page with no Place block", () => {
    const html = `<script type="application/ld+json">{"@type":"Brand"}</script>`;
    expect(inspectDiceVenuePage(html)).toEqual({
      placeFound: false,
      rawEventCount: 0,
      rawEventTypes: [],
    });
  });

  it("handles array-valued @type and malformed blocks", () => {
    const html =
      `<script type="application/ld+json">{ not json</script>` +
      page([{ "@type": ["Event", "MusicEvent"], url: "x" }]);
    expect(inspectDiceVenuePage(html).rawEventTypes).toEqual(["Event|MusicEvent"]);
  });

  /**
   * Since the parser understands DICE's current markup, the observer and
   * the parser must agree on it. If they did not, every run would now
   * report drift that is not there.
   */
  it("agrees with the parser on a current-markup page (no false drift)", () => {
    const html = page([newFormatEvent(1), newFormatEvent(2), newFormatEvent(3)]);
    expect(inspectDiceVenuePage(html).rawEventCount).toBe(3);
    expect(parseDiceVenuePage(html)!.events.length).toBe(3);
  });

  /**
   * Drift is about a FUTURE change we do not yet understand: the page
   * lists events and the parser takes none. Simulated with a type we do
   * not accept, which is what "Event" looked like before the fix.
   */
  it("still detects a page whose events the parser cannot accept", () => {
    const html = page([
      { ...newFormatEvent(1), "@type": "SomeFutureType" },
      { ...newFormatEvent(2), "@type": "SomeFutureType" },
    ]);
    expect(inspectDiceVenuePage(html).rawEventCount).toBe(2);
    expect(parseDiceVenuePage(html)!.events.length).toBe(0);
  });

  it("agrees with the parser on a legacy-format page (no false drift)", () => {
    const html = page([legacyEvent(1), legacyEvent(2)]);
    expect(inspectDiceVenuePage(html).rawEventCount).toBe(2);
    expect(parseDiceVenuePage(html)!.events.length).toBe(2);
  });
});

describe("evaluateDiceRunHealth", () => {
  const drift = { diceShortId: "8p85", rawEventCount: 15, rawEventTypes: ["Event"] };

  it("is healthy when nothing is wrong", () => {
    expect(evaluateDiceRunHealth({ driftPages: [], activeVenuesWithZeroEvents: [] })).toEqual({
      status: "healthy",
      reasons: [],
    });
  });

  it("flags parser drift from a single page", () => {
    expect(
      evaluateDiceRunHealth({ driftPages: [drift], activeVenuesWithZeroEvents: [] }),
    ).toEqual({ status: "unhealthy", reasons: ["parser_drift"] });
  });

  it("does not alarm on one quiet active venue", () => {
    expect(MIN_ACTIVE_VENUES_FOR_ZERO_YIELD_ALERT).toBe(2);
    expect(
      evaluateDiceRunHealth({ driftPages: [], activeVenuesWithZeroEvents: ["Elsewhere"] }),
    ).toEqual({ status: "healthy", reasons: [] });
  });

  it("flags zero events from multiple known-active venues", () => {
    expect(
      evaluateDiceRunHealth({
        driftPages: [],
        activeVenuesWithZeroEvents: ["Elsewhere", "Public Records"],
      }),
    ).toEqual({ status: "unhealthy", reasons: ["zero_events_from_active_venues"] });
  });

  it("reports both reasons together", () => {
    expect(
      evaluateDiceRunHealth({
        driftPages: [drift],
        activeVenuesWithZeroEvents: ["Elsewhere", "Public Records"],
      }).reasons,
    ).toEqual(["parser_drift", "zero_events_from_active_venues"]);
  });
});

describe("assertDiceRunHealthy / DiceIngestHealthError", () => {
  const unhealthy = {
    processedDiceVenues: 5,
    eventsConsidered: 0,
    driftPages: [{ diceShortId: "8p85", rawEventCount: 15, rawEventTypes: ["Event"] }],
    activeVenuesWithZeroEvents: ["Elsewhere", "Public Records"],
    health: {
      status: "unhealthy" as const,
      reasons: ["parser_drift", "zero_events_from_active_venues"] as (
        | "parser_drift"
        | "zero_events_from_active_venues"
      )[],
    },
  };

  it("passes a healthy summary through unchanged", () => {
    const healthy = {
      ...unhealthy,
      driftPages: [],
      activeVenuesWithZeroEvents: [],
      health: { status: "healthy" as const, reasons: [] },
    };
    expect(assertDiceRunHealthy(healthy)).toBe(healthy);
  });

  it("throws with the reasons and the full summary attached", () => {
    let caught: unknown;
    try {
      assertDiceRunHealthy(unhealthy);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DiceIngestHealthError);
    const err = caught as DiceIngestHealthError<typeof unhealthy>;
    expect(err.reasons).toEqual(["parser_drift", "zero_events_from_active_venues"]);
    // withIngestRun persists err.summary, so counts survive the failure.
    expect(err.summary).toBe(unhealthy);
    // The message alone must be enough to act on from a Sentry email.
    expect(err.message).toContain("8p85 listed 15 (types: Event)");
    expect(err.message).toContain("Elsewhere, Public Records");
  });
});
