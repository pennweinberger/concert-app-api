import { describe, it, expect } from "vitest";
import {
  extractDiceEventId,
  parseDiceHeadliner,
  parseCityFromAddress,
  parseDiceVenuePage,
  hasAcceptedEventType,
  startDateToLocalDateUtcMidnight,
  toDiceRawPayload,
  DICE_RAW_PAYLOAD_SCHEMA,
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

  /**
   * DICE's current ids stand alone in the URL. The old terminator set
   * ("-" or end of string) silently returned null for any of these, which
   * would have dropped every event on the page.
   */
  it.each([
    ["https://dice.fm/event/6a9c24f929ff850001191740", "6a9c24f929ff850001191740"],
    ["https://dice.fm/event/6a9c24f929ff850001191740?lng=en-US", "6a9c24f929ff850001191740"],
    ["https://dice.fm/event/6a9c24f929ff850001191740/", "6a9c24f929ff850001191740"],
    ["https://dice.fm/event/6a9c24f929ff850001191740#tickets", "6a9c24f929ff850001191740"],
    ["https://dice.fm/event/6a9c24f929ff850001191740/tickets", "6a9c24f929ff850001191740"],
  ])("extracts a current 24-char id from %s", (url, expected) => {
    expect(extractDiceEventId(url)).toBe(expected);
  });

  it("still extracts legacy 6-char ids in every URL shape", () => {
    for (const [url, expected] of [
      ["https://dice.fm/event/pyb9mp-themba-tickets", "pyb9mp"],
      ["https://dice.fm/event/k63abp-ayybo-tickets?lng=en-US", "k63abp"],
      ["https://dice.fm/event/avr6nq", "avr6nq"],
      ["https://dice.fm/event/avr6nq/", "avr6nq"],
    ] as const) {
      expect(extractDiceEventId(url)).toBe(expected);
    }
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
    // " | " brand/promoter suffix separator (DICE-specific convention)
    ["Black Coffee | Pacha NY Opening Weekend", "Black Coffee"],
    ["DJ Foo | Series Tag | Edition 3", "DJ Foo"],
    // " @ Venue" suffix (DICE staples venue name to headliner sometimes)
    ["Loud Luxury @ Pacha New York", "Loud Luxury"],
    ["Bob Moses @ Brooklyn Paramount", "Bob Moses"],
    // Combination: " @ Venue" followed by " | series" → both stripped
    ["Black Coffee @ Pacha New York | Opening Weekend", "Black Coffee"],
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

describe("hasAcceptedEventType", () => {
  it.each([
    ["MusicEvent", true],
    ["Event", true],
    [["Event", "MusicEvent"], true],
    [["Thing", "Event"], true],
    ["Festival", false],
    ["Thing", false],
    [["Thing"], false],
    [undefined, false],
    [null, false],
    [42, false],
  ])("%s -> %s", (input, expected) => {
    expect(hasAcceptedEventType(input)).toBe(expected);
  });
});

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
    expect(parsed.events[0]!.eventStatus).toBe(
      "https://schema.org/EventScheduled",
    );
    expect(parsed.events[0]!.locationName).toBe("Elsewhere, Brooklyn");
    expect(parsed.events[1]!.providerEventId).toBe("pydg2k");
  });

  /**
   * Data minimization. This fixture's page carries a description, an image,
   * an end date and a street address, exactly as DICE's pages do. None of
   * them is needed for matching, deduplication or the catalog, so the parser
   * must not lift them out at all. Anything never extracted can't reach a
   * database column by accident.
   */
  it("does not extract provider-authored content even when the page carries it", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Place",
      name: "Elsewhere, Brooklyn",
      address: "599 Johnson Ave #1, Brooklyn, NY 11237, USA",
      event: [
        {
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
      ],
    })}</script>`;
    const event = parseDiceVenuePage(html)!.events[0]!;

    expect(Object.keys(event).sort()).toEqual(
      [
        "eventStatus",
        "locationName",
        "name",
        "providerEventId",
        "startDate",
        "url",
      ].sort(),
    );
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("A great show");
    expect(serialized).not.toContain("imgix");
    expect(serialized).not.toContain("599 Johnson");
    expect(serialized).not.toContain("2026-06-21T04:00:00"); // endDate
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

  it("ignores entries whose @type is not an accepted event type", () => {
    // "Event" used to be rejected here. It is DICE's current type and is
    // now accepted; only genuinely unsupported types are skipped.
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Place",
      name: "X",
      event: [
        { "@type": "Place", url: "https://dice.fm/event/abc-tickets", startDate: "2026-06-20T22:30:00-04:00" },
        { "@type": "Event", url: "https://dice.fm/event/abc-tickets", startDate: "2026-06-20T22:30:00-04:00" },
      ],
    })}</script>`;
    const parsed = parseDiceVenuePage(html);
    expect(parsed!.events.map((e) => e.providerEventId)).toEqual(["abc"]);
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

// ---------------------------------------------------------------------------
// toDiceRawPayload — the only shape DICE may write to rawPayload
// ---------------------------------------------------------------------------

describe("toDiceRawPayload", () => {
  const event = {
    providerEventId: "pyb9mp",
    url: "https://dice.fm/event/pyb9mp-themba-tickets",
    name: "THEMBA, TH4YS",
    startDate: "2026-06-20T22:30:00-04:00",
    eventStatus: "https://schema.org/EventScheduled",
    locationName: "Elsewhere, Brooklyn",
  };

  it("uses the dice-minimal-v1 schema marker", () => {
    // The cleanup migration matches on this literal. Changing it would
    // make already-minimized rows look unminimized again.
    expect(DICE_RAW_PAYLOAD_SCHEMA).toBe("dice-minimal-v1");
  });

  it("keeps exactly the approved provenance and matching fields", () => {
    expect(toDiceRawPayload(event)).toEqual({
      _schema: "dice-minimal-v1",
      url: "https://dice.fm/event/pyb9mp-themba-tickets",
      name: "THEMBA, TH4YS",
      startDate: "2026-06-20T22:30:00-04:00",
      eventStatus: "https://schema.org/EventScheduled",
      locationName: "Elsewhere, Brooklyn",
    });
  });

  it("does not duplicate providerEventId, which is already its own column", () => {
    expect(toDiceRawPayload(event)).not.toHaveProperty("providerEventId");
  });

  it("stores absent values as null, so every row has an identical shape", () => {
    const payload = toDiceRawPayload({
      ...event,
      eventStatus: null,
      locationName: null,
    });
    expect(Object.keys(payload).sort()).toEqual(
      ["_schema", "eventStatus", "locationName", "name", "startDate", "url"].sort(),
    );
    expect(payload.eventStatus).toBeNull();
    expect(payload.locationName).toBeNull();
  });

  it("drops anything extra an input object happens to carry", () => {
    // Guards against a future caller passing a richer object straight
    // through: the builder copies named fields, never spreads its input.
    const payload = toDiceRawPayload({
      ...event,
      description: "A great show",
      imageUrls: ["https://dice-media.imgix.net/foo.jpg"],
    } as unknown as typeof event);
    expect(payload).not.toHaveProperty("description");
    expect(payload).not.toHaveProperty("imageUrls");
  });
});


// ---------------------------------------------------------------------------
// Current DICE markup (the September 2026 change)
// ---------------------------------------------------------------------------

describe("parseDiceVenuePage — current markup", () => {
  // Shapes only; names and ids are invented.
  const currentPage = `<script type="application/ld+json">${JSON.stringify({
    "@type": "Place",
    name: "Test Room, Brooklyn",
    address: "1 Test St, Brooklyn, NY 11211, USA",
    event: [
      {
        "@type": "Event",
        url: "https://dice.fm/event/0123456789abcdef01234567",
        name: "Invented Act, Support Act",
        startDate: "2026-10-02T22:30:00-04:00",
        endDate: "2026-10-03T04:00:00-04:00",
        eventStatus: "https://schema.org/EventScheduled",
        location: { "@type": "Place", name: "Test Room, Brooklyn", address: "1 Test St" },
        image: ["https://dice-media.imgix.net/x.jpg"],
        description: "promoter prose",
        offers: [{ "@type": "Offer", price: "20.00", priceCurrency: "USD" }],
      },
      {
        "@type": ["Event", "MusicEvent"],
        url: "https://dice.fm/event/89abcdef0123456789abcdef?lng=en-US",
        name: "Second Act",
        startDate: "2026-10-03T20:00:00-04:00",
        location: { "@type": "Place", name: "Test Room, Rooftop" },
      },
    ],
  })}</script>`;

  it("accepts Event and array-typed events, with their current ids", () => {
    const parsed = parseDiceVenuePage(currentPage)!;
    expect(parsed.events.map((e) => e.providerEventId)).toEqual([
      "0123456789abcdef01234567",
      "89abcdef0123456789abcdef",
    ]);
    expect(parsed.events[0]!.startDate).toBe("2026-10-02T22:30:00-04:00");
    expect(parsed.events[0]!.locationName).toBe("Test Room, Brooklyn");
    expect(parsed.events[1]!.locationName).toBe("Test Room, Rooftop");
  });

  /** The markup fix must not widen what we take from the page. */
  it("still ignores description, images, offers/prices and end dates", () => {
    const parsed = parseDiceVenuePage(currentPage)!;
    for (const event of parsed.events) {
      expect(Object.keys(event).sort()).toEqual(
        ["eventStatus", "locationName", "name", "providerEventId", "startDate", "url"].sort(),
      );
    }
    const serialized = JSON.stringify(parsed.events);
    expect(serialized).not.toContain("promoter prose");
    expect(serialized).not.toContain("imgix");
    expect(serialized).not.toContain("20.00");
    expect(serialized).not.toContain("2026-10-03T04:00:00");
  });

  it("skips entries that are neither Event nor MusicEvent", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Place",
      name: "Test Room",
      event: [
        { "@type": "Festival", url: "https://dice.fm/event/aaaaaaaaaaaaaaaaaaaaaaaa", name: "x", startDate: "2026-10-02T22:30:00-04:00" },
      ],
    })}</script>`;
    expect(parseDiceVenuePage(html)!.events).toEqual([]);
  });
});
