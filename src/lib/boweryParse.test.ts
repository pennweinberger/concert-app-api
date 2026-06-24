import { describe, it, expect } from "vitest";
import {
  parseBoweryFeed,
  eventSkipReason,
  startDateToLocalDateUtcMidnight,
  BowerySchemaDriftError,
  type BoweryEvent,
} from "./boweryParse.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRawEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: "1210894",
    eventDateTimeISO: "2026-09-16T19:00:00-04:00",
    active: true,
    publishStatus: 1,
    private: false,
    title: {
      headlinersText: "The Hayley Williams Show",
      supportingText: "Magdalena Bay + RICO NASTY",
      tour: null,
      eventTitleText: "The Hayley Williams Show",
    },
    ticketing: {
      statusId: 1,
      status: "Buy Tickets",
      ticketURL: "https://shop.axs.com/?c=axs&e=...",
      url: "https://www.axs.com/events/1416004/...",
      eventUrl: "https://www.axs.com/events/1416004/...",
    },
    venue: {
      venueId: "124944",
      title: "Forest Hills Stadium",
      city: "Forest Hills",
      state: "NY",
      address_line: "1 Tennis Place, Forest Hills, NY 11375",
      timezone: "America/New_York",
    },
    ...overrides,
  };
}

function makeFeed(events: Record<string, unknown>[]): Record<string, unknown> {
  return { meta: { total: events.length, locale: "en-US", page: 1, rows: 100 }, events };
}

function asBoweryEvent(raw: Record<string, unknown>): BoweryEvent {
  return parseBoweryFeed(makeFeed([raw])).events[0]!;
}

// ---------------------------------------------------------------------------
// parseBoweryFeed
// ---------------------------------------------------------------------------

describe("parseBoweryFeed", () => {
  it("extracts a well-formed event with all required fields", () => {
    const parsed = parseBoweryFeed(makeFeed([makeRawEvent()]));
    expect(parsed.totalReported).toBe(1);
    expect(parsed.events).toHaveLength(1);
    const e = parsed.events[0]!;
    expect(e.eventId).toBe("1210894");
    expect(e.title.headlinersText).toBe("The Hayley Williams Show");
    expect(e.venue.venueId).toBe("124944");
    expect(e.venue.state).toBe("NY");
    expect(e.active).toBe(true);
    expect(e.publishStatus).toBe(1);
    expect(e.private).toBe(false);
  });

  it("preserves the original raw event for ShowExternalRef.rawPayload", () => {
    const raw = makeRawEvent({ randomExtraField: "preserved" });
    const e = asBoweryEvent(raw);
    expect((e.raw as Record<string, unknown>)["randomExtraField"]).toBe("preserved");
  });

  it("throws BowerySchemaDriftError when root is not an object", () => {
    expect(() => parseBoweryFeed(null)).toThrow(BowerySchemaDriftError);
    expect(() => parseBoweryFeed("oops")).toThrow(BowerySchemaDriftError);
  });

  it("throws BowerySchemaDriftError when events is missing or not an array", () => {
    expect(() => parseBoweryFeed({ meta: {}, events: null })).toThrow(
      BowerySchemaDriftError,
    );
    expect(() => parseBoweryFeed({ meta: {} })).toThrow(BowerySchemaDriftError);
  });

  it("silently drops events missing required fields (eventId, date, venue, title)", () => {
    const events = [
      makeRawEvent({ eventId: null }),
      makeRawEvent({ eventDateTimeISO: "" }),
      makeRawEvent({ title: null }),
      makeRawEvent({ venue: null }),
      makeRawEvent({ venue: { venueId: "x", title: "x", city: "Brooklyn", state: null } }),
      makeRawEvent(), // valid
    ];
    const parsed = parseBoweryFeed(makeFeed(events));
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]!.eventId).toBe("1210894");
  });

  it("defaults missing active/publishStatus/private to safe (will-process) values", () => {
    // When the feed omits these, we treat the event as active enough
    // to consider — eventSkipReason picks up explicit `active: false`
    // and `publishStatus: 0` separately.
    const e = asBoweryEvent(
      makeRawEvent({ active: undefined, publishStatus: undefined, private: undefined }),
    );
    expect(e.active).toBe(true);
    expect(e.publishStatus).toBe(1);
    expect(e.private).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// eventSkipReason
// ---------------------------------------------------------------------------

describe("eventSkipReason", () => {
  it("returns null for a normal active event", () => {
    expect(eventSkipReason(asBoweryEvent(makeRawEvent()))).toBeNull();
  });

  it.each([
    ["Cancelled", "cancelled"],
    ["cancelled", "cancelled"],
    ["CANCELED", "cancelled"], // observed US spelling variant
    ["Postponed", "postponed"],
    ["postponed", "postponed"],
  ])(
    "skips status=%s with reason=%s",
    (status, expected) => {
      const e = asBoweryEvent(
        makeRawEvent({ ticketing: { ...(makeRawEvent().ticketing as object), status } }),
      );
      expect(eventSkipReason(e)).toBe(expected);
    },
  );

  it.each([
    ["Buy Tickets", null],
    ["Coming Soon", null],
    ["Sold Out", null],
    ["Get Tickets", null],
    ["Free", null],
  ])(
    "does NOT skip status=%s (active states)",
    (status, expected) => {
      const e = asBoweryEvent(
        makeRawEvent({ ticketing: { ...(makeRawEvent().ticketing as object), status } }),
      );
      expect(eventSkipReason(e)).toBe(expected);
    },
  );

  it("skips when active is explicitly false", () => {
    const e = asBoweryEvent(makeRawEvent({ active: false }));
    expect(eventSkipReason(e)).toBe("inactive");
  });

  it("skips when publishStatus is 0", () => {
    const e = asBoweryEvent(makeRawEvent({ publishStatus: 0 }));
    expect(eventSkipReason(e)).toBe("unpublished");
  });

  it("skips when private is true", () => {
    const e = asBoweryEvent(makeRawEvent({ private: true }));
    expect(eventSkipReason(e)).toBe("private");
  });

  it("prioritizes inactive over status — defense in depth", () => {
    const e = asBoweryEvent(
      makeRawEvent({
        active: false,
        ticketing: { ...(makeRawEvent().ticketing as object), status: "Cancelled" },
      }),
    );
    expect(eventSkipReason(e)).toBe("inactive");
  });
});

// ---------------------------------------------------------------------------
// startDateToLocalDateUtcMidnight
// ---------------------------------------------------------------------------

describe("startDateToLocalDateUtcMidnight", () => {
  it("extracts the local calendar date from an ISO+offset timestamp", () => {
    expect(
      startDateToLocalDateUtcMidnight("2026-09-16T19:00:00-04:00"),
    ).toEqual(new Date("2026-09-16T00:00:00.000Z"));
  });

  it("uses the date components from the original string, NOT UTC math", () => {
    expect(
      startDateToLocalDateUtcMidnight("2026-06-20T23:30:00+09:00"),
    ).toEqual(new Date("2026-06-20T00:00:00.000Z"));
  });

  it("returns null on malformed input", () => {
    expect(startDateToLocalDateUtcMidnight("not a date")).toBeNull();
    expect(startDateToLocalDateUtcMidnight("")).toBeNull();
    expect(
      startDateToLocalDateUtcMidnight(null as unknown as string),
    ).toBeNull();
  });
});
