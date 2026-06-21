import { describe, it, expect } from "vitest";
import {
  normalizeName,
  fuzzyRatio,
  isLikelyTribute,
  resolveArtist,
  resolveVenue,
  resolveShow,
  decideMatchAction,
  type ArtistCandidate,
  type VenueCandidate,
  type ShowCandidate,
} from "./providerMatch.js";

// ---------------------------------------------------------------------------
// normalizeName
// ---------------------------------------------------------------------------
describe("normalizeName", () => {
  it.each([
    ["The Beatles", "the beatles"],
    ["THE BEATLES", "the beatles"],
    ["  The   Beatles  ", "the beatles"],
    ["AC/DC", "ac dc"],
    ["Beatles & Stones", "beatles and stones"],
    ["Drake (feat. Future)", "drake"],
    ["Drake feat. Future", "drake"],
    ["Drake ft. Future", "drake"],
    ["Drake featuring Future", "drake"],
    ["Madison Square Garden", "madison square garden"],
    ["Madison Square Garden!", "madison square garden"],
    ["The Beatles (Tribute)", "the beatles tribute"],
    ["Sigur Rós", "sigur r s"], // diacritics stripped — known limitation
  ])("%s → %s", (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// fuzzyRatio
// ---------------------------------------------------------------------------
describe("fuzzyRatio", () => {
  it("returns 1 for identical strings", () => {
    expect(fuzzyRatio("the beatles", "the beatles")).toBe(1);
  });
  it("returns 0 for empty input", () => {
    expect(fuzzyRatio("", "the beatles")).toBe(0);
    expect(fuzzyRatio("the beatles", "")).toBe(0);
  });
  it("high score for near-matches", () => {
    // Single-character typo, threshold matches the matching layer (0.80).
    expect(fuzzyRatio("the beatles", "the beatls")).toBeGreaterThan(0.8);
  });
  it("low score for unrelated strings", () => {
    expect(fuzzyRatio("the beatles", "metallica")).toBeLessThan(0.3);
  });
});

// ---------------------------------------------------------------------------
// isLikelyTribute
// ---------------------------------------------------------------------------
describe("isLikelyTribute", () => {
  it.each([
    ["The Beatles Tribute", true],
    ["Beatles tribute band", true],
    ["The Music of Pink Floyd", true],
    ["Songs of Bob Dylan", true],
    ["A Celebration of Prince", true],
    ["Pink Floyd Reimagined", true],
    ["Beatles cover band", true],
  ])("flags '%s' as tribute", (name, expected) => {
    expect(isLikelyTribute(name)).toBe(expected);
  });

  it.each([
    ["The Beatles", false],
    ["The Jimi Hendrix Experience", false], // famously a real band, not a tribute
    ["Untold Story", false],
    ["Tribute (band name)", true], // honest false positive — flagged
  ])("does not flag real band '%s'", (name, expected) => {
    expect(isLikelyTribute(name)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// resolveArtist
// ---------------------------------------------------------------------------
describe("resolveArtist", () => {
  const beatles: ArtistCandidate = {
    id: "artist_beatles",
    name: "The Beatles",
    mbid: "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d",
  };
  const beatlesNoMbid: ArtistCandidate = {
    id: "artist_beatles_no_mbid",
    name: "The Beatles",
    mbid: null,
  };
  const beatlesTribute: ArtistCandidate = {
    id: "artist_beatles_tribute",
    name: "The Beatles Tribute",
    mbid: null,
  };

  it("EXACT when MBID matches", () => {
    const r = resolveArtist(
      { mbid: "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d", name: "The Beatles" },
      [beatles]
    );
    expect(r.confidence).toBe("EXACT");
    expect(r.artistId).toBe("artist_beatles");
    expect(r.reason).toBe("mbid_match");
  });

  it("EXACT MBID wins even when names disagree (diacritics, sort-name)", () => {
    const sigurMbid = "9e7115be-c4dd-432b-be79-7c47ad03f8e3";
    const sigurInDb: ArtistCandidate = {
      id: "a_sigur",
      name: "Sigur Rós", // display name
      mbid: sigurMbid,
    };
    const r = resolveArtist({ mbid: sigurMbid, name: "Sigur Ros" }, [sigurInDb]);
    expect(r.confidence).toBe("EXACT");
    expect(r.artistId).toBe("a_sigur");
  });

  it("PROBABLE when payload has MBID but our DB row does not (name matches)", () => {
    const r = resolveArtist(
      { mbid: "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d", name: "The Beatles" },
      [beatlesNoMbid]
    );
    expect(r.confidence).toBe("PROBABLE");
    expect(r.artistId).toBe("artist_beatles_no_mbid");
    expect(r.reason).toBe("name_match_no_mbid");
  });

  it("PROBABLE when neither side has MBID (missing-MBID scenario)", () => {
    const r = resolveArtist({ name: "The Beatles" }, [beatlesNoMbid]);
    expect(r.confidence).toBe("PROBABLE");
    expect(r.artistId).toBe("artist_beatles_no_mbid");
  });

  it("NEEDS_REVIEW for tribute-vs-real ambiguity (real artist in DB, tribute incoming)", () => {
    // Incoming "Beatles Tribute" normalizes to "beatles tribute".
    // Our DB has just "The Beatles" which normalizes to "the beatles".
    // Tribute-stripped core "beatles" is contained in "the beatles" and
    // the two sides differ in tribute classification → tribute_act.
    const r = resolveArtist({ name: "Beatles Tribute" }, [beatles]);
    expect(r.confidence).toBe("NEEDS_REVIEW");
    expect(r.artistId).toBeNull();
    expect(r.reason).toBe("tribute_act");
  });

  it("NEEDS_REVIEW when names match exactly but tribute keyword present on one side only", () => {
    // Both normalize to "the beatles tribute" if both names include "tribute".
    // But one in DB is non-tribute "The Beatles", the other is "The Beatles Tribute".
    // Construct a case where normalized names DO match exactly but tribute keyword differs.
    const dbReal: ArtistCandidate = { id: "real", name: "Pink Floyd", mbid: null };
    // Incoming with the same normalized name but tribute marker
    const r = resolveArtist({ name: "Pink Floyd tribute" }, [dbReal]);
    // "pink floyd tribute" !== "pink floyd" exactly, so falls to fuzzy → NEEDS_REVIEW
    expect(r.confidence).toBe("NEEDS_REVIEW");
  });

  it("NEEDS_REVIEW when name matches but tribute marker on only payload side (exact normalized match scenario)", () => {
    // Force a normalized name match by giving both the same trailing token,
    // exercising the tribute_act branch inside resolveArtist.
    const dbWithTribute: ArtistCandidate = {
      id: "db_t",
      name: "Pink Floyd Tribute",
      mbid: null,
    };
    const r = resolveArtist({ name: "Pink Floyd Tribute" }, [dbWithTribute]);
    // Both sides flagged as tribute → same kind → PROBABLE (same tribute act)
    expect(r.confidence).toBe("PROBABLE");
  });

  it("NEEDS_REVIEW for fuzzy artist name (no exact match, >= 0.85 similarity)", () => {
    const taylor: ArtistCandidate = { id: "t", name: "Taylor Swift", mbid: null };
    const r = resolveArtist({ name: "Taylor Swft" }, [taylor]);
    expect(r.confidence).toBe("NEEDS_REVIEW");
    expect(r.reason).toBe("artist_fuzzy");
  });

  it("NEEDS_REVIEW when multiple candidates have the same normalized name", () => {
    const dup1: ArtistCandidate = { id: "d1", name: "Phoenix", mbid: null };
    const dup2: ArtistCandidate = { id: "d2", name: "Phoenix", mbid: null };
    const r = resolveArtist({ name: "Phoenix" }, [dup1, dup2]);
    expect(r.confidence).toBe("NEEDS_REVIEW");
    expect(r.reason).toBe("multiple_artist_candidates");
  });

  it("NEW when no candidate matches at all", () => {
    const someone: ArtistCandidate = { id: "x", name: "Metallica", mbid: null };
    const r = resolveArtist({ name: "Charli XCX" }, [someone]);
    expect(r.confidence).toBe("NEW");
    expect(r.artistId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveVenue
// ---------------------------------------------------------------------------
describe("resolveVenue", () => {
  const msg: VenueCandidate = {
    id: "v_msg",
    name: "Madison Square Garden",
    city: "New York",
    externalRefs: [{ provider: "ticketmaster", providerVenueId: "tm_msg_123" }],
  };

  it("EXACT when an existing VenueExternalRef matches the provider id", () => {
    const msgWithSetlistfm: VenueCandidate = {
      ...msg,
      externalRefs: [
        ...msg.externalRefs,
        { provider: "setlistfm", providerVenueId: "slfm_msg_456" },
      ],
    };
    const r = resolveVenue(
      { id: "slfm_msg_456", name: "Madison Square Garden", city: "New York" },
      [msgWithSetlistfm]
    );
    expect(r.confidence).toBe("EXACT");
    expect(r.venueId).toBe("v_msg");
    expect(r.reason).toBe("external_ref_match");
  });

  it("PROBABLE when name + city match but no external_ref yet (first setlist.fm event for a TM venue)", () => {
    const r = resolveVenue(
      { id: "slfm_msg_456", name: "Madison Square Garden", city: "New York" },
      [msg]
    );
    expect(r.confidence).toBe("PROBABLE");
    expect(r.venueId).toBe("v_msg");
    expect(r.reason).toBe("venue_name_city_match");
  });

  it("PROBABLE on fuzzy venue name within same city", () => {
    const r = resolveVenue(
      { id: "slfm_msg_456", name: "Madison Sqaure Gardens", city: "New York" },
      [msg]
    );
    expect(r.confidence).toBe("PROBABLE");
    expect(r.venueId).toBe("v_msg");
    expect(r.reason).toBe("venue_fuzzy_match");
  });

  it("NEEDS_REVIEW when multiple venues in same city share the normalized name", () => {
    const dup1: VenueCandidate = {
      id: "v1",
      name: "The Forum",
      city: "Inglewood",
      externalRefs: [],
    };
    const dup2: VenueCandidate = {
      id: "v2",
      name: "The Forum",
      city: "Inglewood",
      externalRefs: [],
    };
    const r = resolveVenue(
      { id: "x", name: "The Forum", city: "Inglewood" },
      [dup1, dup2]
    );
    expect(r.confidence).toBe("NEEDS_REVIEW");
    expect(r.reason).toBe("multiple_venue_candidates");
  });

  it("NEW when no venue matches", () => {
    const r = resolveVenue(
      { id: "x", name: "Some Place", city: "Tucson" },
      [msg]
    );
    expect(r.confidence).toBe("NEW");
  });
});

// ---------------------------------------------------------------------------
// resolveShow
// ---------------------------------------------------------------------------
describe("resolveShow", () => {
  const showA: ShowCandidate = {
    id: "show_a",
    artistId: "artist_x",
    venueId: "venue_a",
    localDate: new Date("2026-07-15T00:00:00.000Z"),
  };

  it("EXACT when (artistId, venueId, localDate) all match", () => {
    const r = resolveShow(
      {
        artistId: "artist_x",
        venueId: "venue_a",
        localDate: new Date("2026-07-15T00:00:00.000Z"),
      },
      [showA]
    );
    expect(r.confidence).toBe("EXACT");
    expect(r.showId).toBe("show_a");
    expect(r.reason).toBe("exact_match");
  });

  it("PROBABLE when artist+venue match but date drifts by 1 day", () => {
    const r = resolveShow(
      {
        artistId: "artist_x",
        venueId: "venue_a",
        localDate: new Date("2026-07-16T00:00:00.000Z"),
      },
      [showA]
    );
    expect(r.confidence).toBe("PROBABLE");
    expect(r.showId).toBeNull();
    expect(r.candidateShowIds).toEqual(["show_a"]);
    expect(r.reason).toBe("date_drift");
  });

  it("NEEDS_REVIEW when same artist + same date but different venueId (potential venue mismatch)", () => {
    // Caller resolved venue_b, but DB has a show for the same artist on the
    // same date at venue_a. Could be the same real show with the wrong venue
    // resolution, or a separate real show.
    const r = resolveShow(
      {
        artistId: "artist_x",
        venueId: "venue_b",
        localDate: new Date("2026-07-15T00:00:00.000Z"),
      },
      [showA]
    );
    expect(r.confidence).toBe("NEEDS_REVIEW");
    expect(r.candidateShowIds).toEqual(["show_a"]);
    expect(r.reason).toBe("different_venue_same_date");
  });

  it("NEW when no show with the resolved artist+venue exists within a day", () => {
    const r = resolveShow(
      {
        artistId: "artist_x",
        venueId: "venue_a",
        localDate: new Date("2027-03-01T00:00:00.000Z"),
      },
      [showA]
    );
    expect(r.confidence).toBe("NEW");
    expect(r.candidateShowIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// decideMatchAction — the full orchestration that step 5 (cron) will use
// ---------------------------------------------------------------------------
describe("decideMatchAction (orchestration)", () => {
  it("AUTO_MERGE: artist EXACT (mbid) + venue EXACT (external_ref) + show EXACT", () => {
    const d = decideMatchAction(
      { confidence: "EXACT", artistId: "a", reason: "mbid_match" },
      { confidence: "EXACT", venueId: "v", reason: "external_ref_match" },
      {
        confidence: "EXACT",
        showId: "s",
        candidateShowIds: [],
        reason: "exact_match",
      }
    );
    expect(d.action).toBe("AUTO_MERGE");
    expect(d.artistId).toBe("a");
    expect(d.venueId).toBe("v");
    expect(d.showId).toBe("s");
  });

  it("REVIEW: TM show exists + first-time setlist.fm ref (venue PROBABLE because no external_ref yet)", () => {
    // The most important integration scenario.
    // Artist matched by MBID → EXACT.
    // Venue matched by name+city, but no setlist.fm external_ref yet → PROBABLE.
    // Show matched (because artist+venue+date hit our DB) → EXACT.
    // Because venue is PROBABLE, we do NOT auto-merge: defer to admin
    // so they can confirm the venue identity and create the VenueExternalRef.
    const d = decideMatchAction(
      { confidence: "EXACT", artistId: "a", reason: "mbid_match" },
      { confidence: "PROBABLE", venueId: "v", reason: "venue_name_city_match" },
      {
        confidence: "EXACT",
        showId: "s",
        candidateShowIds: [],
        reason: "exact_match",
      }
    );
    expect(d.action).toBe("REVIEW");
    expect(d.artistId).toBe("a");
    expect(d.venueId).toBe("v");
    expect(d.showId).toBeNull(); // never populated outside AUTO_MERGE
  });

  it("REVIEW: date drift", () => {
    const d = decideMatchAction(
      { confidence: "EXACT", artistId: "a", reason: "mbid_match" },
      { confidence: "EXACT", venueId: "v", reason: "external_ref_match" },
      {
        confidence: "PROBABLE",
        showId: null,
        candidateShowIds: ["s1"],
        reason: "date_drift",
      }
    );
    expect(d.action).toBe("REVIEW");
    expect(d.candidateShowIds).toEqual(["s1"]);
  });

  it("REVIEW: tribute-act ambiguity routes via artist NEEDS_REVIEW", () => {
    const d = decideMatchAction(
      { confidence: "NEEDS_REVIEW", artistId: null, reason: "tribute_act" },
      { confidence: "EXACT", venueId: "v", reason: "external_ref_match" },
      {
        confidence: "NEW",
        showId: null,
        candidateShowIds: [],
        reason: "no_show_match",
      }
    );
    expect(d.action).toBe("REVIEW");
    expect(d.artistId).toBeNull();
  });

  it("REVIEW: fuzzy artist name routes via NEEDS_REVIEW", () => {
    const d = decideMatchAction(
      { confidence: "NEEDS_REVIEW", artistId: null, reason: "artist_fuzzy" },
      { confidence: "NEW", venueId: null, reason: "no_venue_match" },
      {
        confidence: "NEW",
        showId: null,
        candidateShowIds: [],
        reason: "no_show_match",
      }
    );
    expect(d.action).toBe("REVIEW");
  });

  it("REVIEW: same city, different venue at show level", () => {
    const d = decideMatchAction(
      { confidence: "EXACT", artistId: "a", reason: "mbid_match" },
      { confidence: "PROBABLE", venueId: "v_b", reason: "venue_name_city_match" },
      {
        confidence: "NEEDS_REVIEW",
        showId: null,
        candidateShowIds: ["s_at_v_a"],
        reason: "different_venue_same_date",
      }
    );
    expect(d.action).toBe("REVIEW");
    expect(d.candidateShowIds).toEqual(["s_at_v_a"]);
  });

  it("AUTO_MERGE (promoted): artist name-match-no-mbid + venue EXACT + show EXACT", () => {
    // Name-only artist match is normally PROBABLE → REVIEW. But when
    // venue is EXACT and show is EXACT, the corroborating signals
    // make the artist match unambiguous → promote to AUTO_MERGE.
    // Without this, providers that lack stable artist ids (DICE)
    // would never auto-merge.
    const d = decideMatchAction(
      {
        confidence: "PROBABLE",
        artistId: "a",
        reason: "name_match_no_mbid",
      },
      { confidence: "EXACT", venueId: "v", reason: "dice_external_ref_match" },
      {
        confidence: "EXACT",
        showId: "s",
        candidateShowIds: [],
        reason: "exact_match",
      }
    );
    expect(d.action).toBe("AUTO_MERGE");
    expect(d.artistId).toBe("a");
    expect(d.venueId).toBe("v");
    expect(d.showId).toBe("s");
  });

  it("REVIEW (not promoted): artist PROBABLE name_match_no_mbid but venue is PROBABLE (not EXACT)", () => {
    // Promotion only fires when BOTH venue and show are EXACT. Here
    // venue is PROBABLE so the safety net holds: REVIEW.
    const d = decideMatchAction(
      {
        confidence: "PROBABLE",
        artistId: "a",
        reason: "name_match_no_mbid",
      },
      { confidence: "PROBABLE", venueId: "v", reason: "venue_name_city_match" },
      {
        confidence: "EXACT",
        showId: "s",
        candidateShowIds: [],
        reason: "exact_match",
      }
    );
    expect(d.action).toBe("REVIEW");
    expect(d.showId).toBeNull();
  });

  it("REVIEW (not promoted): artist PROBABLE name_match_no_mbid but show is NEW (no exact match)", () => {
    // Show NEW means no existing canonical show to merge onto. The
    // promotion is specifically for the case where we'd be attaching
    // a provider ref to an already-known canonical show.
    const d = decideMatchAction(
      {
        confidence: "PROBABLE",
        artistId: "a",
        reason: "name_match_no_mbid",
      },
      { confidence: "EXACT", venueId: "v", reason: "dice_external_ref_match" },
      {
        confidence: "NEW",
        showId: null,
        candidateShowIds: [],
        reason: "no_show_match",
      }
    );
    expect(d.action).toBe("REVIEW");
  });

  it("REVIEW (not promoted): artist PROBABLE with a non-promotable reason (e.g. fuzzy match)", () => {
    // The promotion clause checks reason === "name_match_no_mbid"
    // specifically. Other PROBABLE reasons (if any) are NOT promoted.
    const d = decideMatchAction(
      {
        confidence: "PROBABLE",
        artistId: "a",
        reason: "some_other_probable_reason",
      },
      { confidence: "EXACT", venueId: "v", reason: "dice_external_ref_match" },
      {
        confidence: "EXACT",
        showId: "s",
        candidateShowIds: [],
        reason: "exact_match",
      }
    );
    expect(d.action).toBe("REVIEW");
  });

  it("REVIEW: multiple venue candidates", () => {
    const d = decideMatchAction(
      { confidence: "EXACT", artistId: "a", reason: "mbid_match" },
      {
        confidence: "NEEDS_REVIEW",
        venueId: null,
        reason: "multiple_venue_candidates",
      },
      {
        confidence: "NEW",
        showId: null,
        candidateShowIds: [],
        reason: "no_show_match",
      }
    );
    expect(d.action).toBe("REVIEW");
  });

  it("CREATE_NEW: artist EXACT, venue NEW, show NEW", () => {
    // Known artist played at a brand-new venue we haven't seen.
    const d = decideMatchAction(
      { confidence: "EXACT", artistId: "a", reason: "mbid_match" },
      { confidence: "NEW", venueId: null, reason: "no_venue_match" },
      {
        confidence: "NEW",
        showId: null,
        candidateShowIds: [],
        reason: "no_show_match",
      }
    );
    expect(d.action).toBe("CREATE_NEW");
    expect(d.artistId).toBe("a");
    expect(d.venueId).toBeNull();
    expect(d.showId).toBeNull();
  });

  it("CREATE_NEW: artist EXACT, venue EXACT, show NEW (known act at known venue, new date)", () => {
    const d = decideMatchAction(
      { confidence: "EXACT", artistId: "a", reason: "mbid_match" },
      { confidence: "EXACT", venueId: "v", reason: "external_ref_match" },
      {
        confidence: "NEW",
        showId: null,
        candidateShowIds: [],
        reason: "no_show_match",
      }
    );
    expect(d.action).toBe("CREATE_NEW");
    expect(d.artistId).toBe("a");
    expect(d.venueId).toBe("v");
  });

  it("CREATE_NEW: all NEW (truly novel)", () => {
    const d = decideMatchAction(
      { confidence: "NEW", artistId: null, reason: "no_artist_match" },
      { confidence: "NEW", venueId: null, reason: "no_venue_match" },
      {
        confidence: "NEW",
        showId: null,
        candidateShowIds: [],
        reason: "no_show_match",
      }
    );
    expect(d.action).toBe("CREATE_NEW");
  });
});
