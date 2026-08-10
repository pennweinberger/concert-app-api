import { describe, it, expect } from "vitest";
import {
  parseTicketmasterEvent,
  parseTicketmasterEvents,
  mapStatus,
  localDateToUtcMidnight,
} from "./ticketmasterParse.js";

const baseEvent = (over: Record<string, any> = {}) => ({
  id: "tm_1",
  name: "Beach House: Once Twice Melody Tour",
  url: "https://ticketmaster.com/x",
  dates: {
    start: { localDate: "2026-09-02", dateTime: "2026-09-03T00:00:00Z" },
    status: { code: "onsale" },
    timezone: "America/New_York",
  },
  _embedded: {
    attractions: [{ id: "K8vZ1", name: "Beach House" }],
    venues: [
      {
        id: "KovZ1",
        name: "Brooklyn Steel",
        city: { name: "Brooklyn" },
        state: { stateCode: "NY" },
        country: { countryCode: "US" },
      },
    ],
  },
  ...over,
});

describe("mapStatus", () => {
  it("maps explicit provider codes", () => {
    expect(mapStatus("cancelled")).toBe("cancelled");
    expect(mapStatus("canceled")).toBe("cancelled");
    expect(mapStatus("postponed")).toBe("postponed");
    expect(mapStatus("rescheduled")).toBe("rescheduled");
  });

  it("treats offsale as scheduled — it means tickets stopped selling, not that the show is off", () => {
    expect(mapStatus("offsale")).toBe("scheduled");
    expect(mapStatus("onsale")).toBe("scheduled");
    expect(mapStatus(undefined)).toBe("scheduled");
    expect(mapStatus("")).toBe("scheduled");
  });
});

describe("localDateToUtcMidnight", () => {
  it("anchors the local calendar date at UTC midnight", () => {
    expect(localDateToUtcMidnight("2026-09-02")!.toISOString()).toBe(
      "2026-09-02T00:00:00.000Z",
    );
  });

  it("rejects anything that isn't a plain date", () => {
    expect(localDateToUtcMidnight("2026-09-02T20:00:00Z")).toBeNull();
    expect(localDateToUtcMidnight("nonsense")).toBeNull();
    expect(localDateToUtcMidnight("")).toBeNull();
  });
});

describe("parseTicketmasterEvent", () => {
  it("maps a full event to the neutral shape", () => {
    const e = parseTicketmasterEvent(baseEvent())!;
    expect(e.provider).toBe("ticketmaster");
    expect(e.providerEventId).toBe("tm_1");
    expect(e.artist).toEqual({ name: "Beach House", providerId: "K8vZ1" });
    expect(e.venue.name).toBe("Brooklyn Steel");
    expect(e.venue.city).toBe("Brooklyn");
    expect(e.venue.providerId).toBe("KovZ1");
    expect(e.localDate.toISOString()).toBe("2026-09-02T00:00:00.000Z");
    expect(e.status).toBe("scheduled");
  });

  it("uses the ATTRACTION as the artist, never the event title", () => {
    // The event name is a tour title; using it would create junk artists
    // like "Madison Square Garden Tour Experience".
    const e = parseTicketmasterEvent(baseEvent())!;
    expect(e.artist.name).toBe("Beach House");
    expect(e.artist.name).not.toContain("Tour");
  });

  it("leaves the artist name empty when there is no attraction, rather than inventing one", () => {
    const e = parseTicketmasterEvent(
      baseEvent({ _embedded: { venues: baseEvent()._embedded.venues } }),
    )!;
    expect(e.artist.name).toBe("");
  });

  it("normalizes the trailing-space city variant Ticketmaster actually emits", () => {
    const e = parseTicketmasterEvent(
      baseEvent({
        _embedded: {
          attractions: [{ id: "K8vZ1", name: "Beach House" }],
          venues: [
            {
              id: "KovZ1",
              name: "  Brooklyn  Steel ",
              city: { name: "Brooklyn " },
            },
          ],
        },
      }),
    )!;
    // Venue is unique on (name, city); un-normalized these would create
    // a second Brooklyn Steel and split the room's shows in two.
    expect(e.venue.city).toBe("Brooklyn");
    expect(e.venue.name).toBe("Brooklyn Steel");
  });

  it("tolerates a missing exact start time", () => {
    const ev = baseEvent();
    delete (ev.dates.start as any).dateTime;
    const e = parseTicketmasterEvent(ev)!;
    expect(e.startDatetimeUtc).toBeNull();
    expect(e.localDate).toBeInstanceOf(Date);
  });

  it("returns null without an id or a usable date", () => {
    expect(parseTicketmasterEvent({ ...baseEvent(), id: "" })).toBeNull();
    const noDate = baseEvent();
    (noDate.dates.start as any).localDate = undefined;
    expect(parseTicketmasterEvent(noDate)).toBeNull();
  });

  it("stores a trimmed raw payload, not the whole multi-KB event", () => {
    const e = parseTicketmasterEvent(
      baseEvent({ images: new Array(40).fill({ url: "x" }) }),
    )!;
    expect(e.raw).not.toHaveProperty("images");
    expect(e.raw).toMatchObject({ id: "tm_1", venue: "Brooklyn Steel" });
  });
});

describe("parseTicketmasterEvents", () => {
  it("drops unparseable rows and keeps the rest", () => {
    const out = parseTicketmasterEvents([
      baseEvent(),
      { id: "" },
      baseEvent({ id: "tm_2" }),
    ]);
    expect(out.map((e) => e.providerEventId)).toEqual(["tm_1", "tm_2"]);
  });

  it("handles an empty or missing list", () => {
    expect(parseTicketmasterEvents([])).toEqual([]);
    expect(parseTicketmasterEvents(undefined as any)).toEqual([]);
  });
});
