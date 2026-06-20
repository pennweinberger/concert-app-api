import { describe, it, expect } from "vitest";
import {
  extractDiceEventId,
  parseDiceHeadliner,
  parseCityFromAddress,
  parseDiceVenuePage,
  startDateToLocalDateUtcMidnight,
} from "./diceParse.js";

// ---------------------------------------------------------------------------
// extractDiceEventId
// ---------------------------------------------------------------------------

describe("extractDiceEventId", () => {
  it.each([
    [
      "https://dice.fm/event/pyb9mp-themba-th4ys-…-tickets",
      "pyb9mp",
    ],
    [
      "https://dice.fm/event/mx792r-the-nursery-2026-season-pass-2nd-may-public-records-new-york-tickets",
      "mx792r",
    ],
    [
      "https://dice.fm/event/avr6nq-eli-escobar-open-to-close-rapture-tickets",
      "avr6nq",
    ],
    [
      "https://dice.fm/event/k63abp-ayybo-99-scott-courtyard-tickets?lng=en-US",
      "k63abp",
    ],
  ])("extracts id from %s", (url, expectedId) => {
    expect(extractDiceEventId(url)).toBe(expectedId);
  });

  it("returns null on URLs that don't match the event pattern", () => {
    expect(extractDiceEventId("https://dice.fm/venue/elsewhere-brooklyn-8p85")).toBeNull();
    expect(extractDiceEventId("https://dice.fm/")).toBeNull();
    expect(extractDiceEventId("")).toBeNull();
  });

  it("survives non-string input", () => {
    expect(extractDiceEventId(null as unknown as string)).toBeNull();
    expect(extractDiceEventId(undefined as unknown as string)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseDiceHeadliner — the heuristic
// ---------------------------------------------------------------------------

describe("parseDiceHeadliner", () => {
  it.each([
    // Simple comma-separated lineup
    ["Elujay, Hush Forte", "Elujay"],
    ["Bradley Zero, Pender Street Steppers", "Bradley Zero"],
    // Series prefix
    ["The Nursery: Bradley Zero, Pender Street Steppers", "Bradley Zero"],
    ["BLUE: ALISHA, RUZE, LIGHTLEAK, Sahil Morchi", "ALISHA"],
    // Bracket annotations
    ["Kareem Ali [Live]", "Kareem Ali"],
    ["AYYBO [LATE NIGHT]", "AYYBO"],
    // Room/set splitter
    [
      "Frank & Tony, Kareem Ali [Live] / Gene Hunt, JADALAREIGN / Mesmé",
      "Frank & Tony",
    ],
    // "by" — the artist is what comes after
    ["Cell Injection Open-to-Close by Gray Area", "Gray Area"],
    [
      "Moving House Forward by DESCENDANTS with DJ Lag [UPSTAIRS]",
      "DESCENDANTS",
    ],
    // "with" — split off support
    ["Prunk with M-High", "Prunk"],
    // "presents" — take what comes after
    ["Teksupport presents FOUR TET", "FOUR TET"],
    ["The Summer Club Presents: Pickle", "Pickle"],
    // Long event name with mid-string colon and many commas — DON'T strip
    [
      "THEMBA, TH4YS, unfazed, Papi Weli, Sound Lab: SHAWNA SOLARIS, BRINGYOURFRIENDS",
      "THEMBA",
    ],
    // Single artist, no special chars
    ["Hayley Williams", "Hayley Williams"],
    // Parenthetical annotation
    ["Eli Escobar (Open To Close)", "Eli Escobar"],
  ])("'%s' → '%s'", (input, expected) => {
    expect(parseDiceHeadliner(input)).toBe(expected);
  });

  it("falls back to original on degenerate input", () => {
    expect(parseDiceHeadliner("")).toBe("");
    expect(parseDiceHeadliner("   ")).toBe("");
  });

  it("returns original when stripping leaves empty", () => {
    // Pure annotations get fully stripped — fall back to original.
    expect(parseDiceHeadliner("[Live]")).toBe("[Live]");
  });

  it("survives non-string input", () => {
    expect(parseDiceHeadliner(null as unknown as string)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// parseCityFromAddress
// ---------------------------------------------------------------------------

describe("parseCityFromAddress", () => {
  it.each([
    ["599 Johnson Ave #1, Brooklyn, NY 11237, USA", "Brooklyn"],
    ["233 Butler St, Brooklyn, NY 11217, USA", "Brooklyn"],
    ["52-19 Flushing Ave, Maspeth, NY 11378, USA", "Maspeth"],
    ["287 10th Avenue, New York, NY 10001, USA", "New York"],
    ["1090 Wyckoff Ave, Queens, NY 11385, USA", "Queens"],
  ])("'%s' → '%s'", (input, expected) => {
    expect(parseCityFromAddress(input)).toBe(expected);
  });

  it("returns null when not enough comma-separated parts", () => {
    expect(parseCityFromAddress("just a street")).toBeNull();
    expect(parseCityFromAddress("Street, City")).toBeNull(); // only 2 parts
  });
});

// ---------------------------------------------------------------------------
// parseDiceVenuePage — JSON-LD extraction
// ---------------------------------------------------------------------------

describe("parseDiceVenuePage", () => {
  it("extracts the Place JSON-LD and its events", () => {
    const html = `
<html>
<head>
<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Brand",
      name: "DICE",
    })}</script>
<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Place",
      name: "Elsewhere, Brooklyn",
      address: "599 Johnson Ave #1, Brooklyn, NY 11237, USA",
      url: "https://dice.fm/venue/elsewhere-brooklyn-8p85",
      event: [
        {
          "@context": "https://schema.org",
          "@type": "MusicEvent",
          url: "https://dice.fm/event/pyb9mp-themba-tickets",
          name: "THEMBA, TH4YS",
          startDate: "2026-06-20T22:30:00-04:00",
          endDate: "2026-06-21T04:00:00-04:00",
          eventStatus: "https://schema.org/EventScheduled",
          location: {
            "@type": "Place",
            name: "Elsewhere, Brooklyn",
            address: "599 Johnson Ave #1, Brooklyn, NY 11237, USA",
          },
          image: ["https://dice-media.imgix.net/foo.jpg"],
          description: "A great show",
        },
        {
          "@type": "MusicEvent",
          url: "https://dice.fm/event/pydg2k-elujay-tickets",
          name: "Elujay, Hush Forte",
          startDate: "2026-06-21T20:00:00-04:00",
          eventStatus: "https://schema.org/EventScheduled",
          location: {
            "@type": "Place",
            name: "Elsewhere, Brooklyn",
            address: "599 Johnson Ave #1, Brooklyn, NY 11237, USA",
          },
        },
      ],
    })}</script>
</head>
<body>...</body>
</html>`;
    const parsed = parseDiceVenuePage(html);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(parsed.venueName).toBe("Elsewhere, Brooklyn");
    expect(parsed.venueAddress).toBe(
      "599 Johnson Ave #1, Brooklyn, NY 11237, USA",
    );
    expect(parsed.events.length).toBe(2);
    expect(parsed.events[0]!.providerEventId).toBe("pyb9mp");
    expect(parsed.events[0]!.name).toBe("THEMBA, TH4YS");
    expect(parsed.events[0]!.startDate).toBe("2026-06-20T22:30:00-04:00");
    expect(parsed.events[0]!.endDate).toBe("2026-06-21T04:00:00-04:00");
    expect(parsed.events[0]!.eventStatus).toBe(
      "https://schema.org/EventScheduled",
    );
    expect(parsed.events[0]!.imageUrls).toEqual([
      "https://dice-media.imgix.net/foo.jpg",
    ]);
    expect(parsed.events[1]!.providerEventId).toBe("pydg2k");
  });

  it("returns null when no Place JSON-LD is present", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "WebSite",
      url: "https://dice.fm",
    })}</script>`;
    expect(parseDiceVenuePage(html)).toBeNull();
  });

  it("skips malformed JSON-LD blocks rather than throwing", () => {
    const html = `
<script type="application/ld+json">{NOT VALID JSON}</script>
<script type="application/ld+json">${JSON.stringify({
      "@type": "Place",
      name: "Elsewhere",
      event: [],
    })}</script>`;
    const parsed = parseDiceVenuePage(html);
    expect(parsed).not.toBeNull();
    expect(parsed!.events.length).toBe(0);
  });

  it("skips events with missing url or startDate", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Place",
      name: "X",
      event: [
        { "@type": "MusicEvent", url: "", startDate: "2026-06-20T22:30:00-04:00" },
        {
          "@type": "MusicEvent",
          url: "https://dice.fm/event/abc-tickets",
          startDate: "",
        },
        {
          "@type": "MusicEvent",
          url: "https://dice.fm/event/valid-x-tickets",
          startDate: "2026-06-20T22:30:00-04:00",
          name: "Valid",
        },
      ],
    })}</script>`;
    const parsed = parseDiceVenuePage(html);
    expect(parsed!.events.length).toBe(1);
    expect(parsed!.events[0]!.providerEventId).toBe("valid");
  });

  it("ignores non-MusicEvent entries in the event array", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Place",
      name: "X",
      event: [
        { "@type": "Event", url: "https://dice.fm/event/abc-tickets", startDate: "2026-06-20T22:30:00-04:00" },
      ],
    })}</script>`;
    const parsed = parseDiceVenuePage(html);
    expect(parsed!.events.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// startDateToLocalDateUtcMidnight
// ---------------------------------------------------------------------------

describe("startDateToLocalDateUtcMidnight", () => {
  it("extracts the local calendar date from an ISO+offset timestamp", () => {
    // 22:30 -04:00 on 2026-06-20 → local date 2026-06-20.
    expect(
      startDateToLocalDateUtcMidnight("2026-06-20T22:30:00-04:00"),
    ).toEqual(new Date("2026-06-20T00:00:00.000Z"));
  });

  it("uses the date components from the original string, NOT UTC math", () => {
    // 23:30 +09:00 on 2026-06-20 → local date 2026-06-20, even though
    // UTC is already 2026-06-20T14:30Z (same day in UTC) or for a
    // negative offset would shift.
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
