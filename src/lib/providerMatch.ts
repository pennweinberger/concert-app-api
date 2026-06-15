// Provider matching — pure functions only.
//
// Given a setlist.fm payload (or any future provider's normalized
// equivalent) and a set of DB-loaded candidates, produces a MatchDecision
// the caller can act on. Never queries the DB, never mutates state,
// never hits the network.
//
// Design priority: precision over recall. A real concert with two
// duplicate Show rows is recoverable; two real concerts merged into one
// Show row corrupts user-facing data and is hard to unwind. So the
// AUTO_MERGE path requires every signal to be EXACT; anything ambiguous
// routes to REVIEW.

// ---------------------------------------------------------------------------
// String normalization helpers
// ---------------------------------------------------------------------------

const FEATURING_RE =
  /\s*\(?\b(feat\.?|featuring|ft\.?|with)\b[^)]*\)?/gi;

const TRIBUTE_KEYWORDS =
  "tribute|cover band|tribute band|the music of|songs of|reimagined|reinvented|a celebration of";
const TRIBUTE_TEST_RE = new RegExp(`\\b(${TRIBUTE_KEYWORDS})\\b`, "i");
const TRIBUTE_STRIP_RE = new RegExp(`\\b(${TRIBUTE_KEYWORDS})\\b`, "gi");

const FUZZY_THRESHOLD = 0.8;

function stripTributeKeywords(s: string): string {
  return normalizeName(s.replace(TRIBUTE_STRIP_RE, " "));
}

const NON_ALNUM_SPACE_RE = /[^a-z0-9 ]+/g;
const MULTI_WHITESPACE_RE = /\s+/g;

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(FEATURING_RE, " ")
    .replace(NON_ALNUM_SPACE_RE, " ")
    .replace(MULTI_WHITESPACE_RE, " ")
    .trim();
}

// Dice coefficient on character bigrams. Returns 0..1.
// Empty/short strings degrade gracefully.
export function fuzzyRatio(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      m.set(bg, (m.get(bg) ?? 0) + 1);
    }
    return m;
  };

  const aBigrams = bigrams(a);
  const bBigrams = bigrams(b);
  let intersection = 0;
  let aTotal = 0;
  let bTotal = 0;
  for (const v of aBigrams.values()) aTotal += v;
  for (const v of bBigrams.values()) bTotal += v;
  for (const [bg, av] of aBigrams) {
    const bv = bBigrams.get(bg);
    if (bv !== undefined) intersection += Math.min(av, bv);
  }
  return (2 * intersection) / (aTotal + bTotal);
}

// Conservative tribute-act detector. Only flags strings where we're highly
// confident a tribute keyword is present. Ambiguous words like
// "experience" or "story" deliberately omitted — those are legitimate
// substrings of real band names.
export function isLikelyTribute(name: string): boolean {
  return TRIBUTE_TEST_RE.test(name);
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

// Both arguments compared at UTC date precision — ignores time-of-day.
function sameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function absDaysBetween(a: Date, b: Date): number {
  const aDay = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const bDay = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.abs(Math.round((aDay - bDay) / 86_400_000));
}

// ---------------------------------------------------------------------------
// Confidence + resolution types
// ---------------------------------------------------------------------------

export type Confidence = "EXACT" | "PROBABLE" | "NEEDS_REVIEW" | "NEW";

export type ArtistResolution = {
  confidence: Confidence;
  artistId: string | null;
  reason: string;
};

export type VenueResolution = {
  confidence: Confidence;
  venueId: string | null;
  reason: string;
};

export type ShowResolution = {
  confidence: Confidence;
  showId: string | null;
  candidateShowIds: string[];
  reason: string;
};

// ---------------------------------------------------------------------------
// Artist resolution
// ---------------------------------------------------------------------------

export type ArtistCandidate = {
  id: string;
  name: string;
  mbid: string | null;
};

export type ArtistPayload = {
  mbid?: string | undefined;
  name: string;
};

export function resolveArtist(
  payload: ArtistPayload,
  candidates: ArtistCandidate[]
): ArtistResolution {
  // 1. mbid match: definitive. MusicBrainz already deduplicates real
  //    artists from tributes (different mbids), so we trust mbid even
  //    when names diverge (diacritics, sort-name vs display-name, etc.).
  if (payload.mbid) {
    const m = candidates.find((c) => c.mbid === payload.mbid);
    if (m) {
      return { confidence: "EXACT", artistId: m.id, reason: "mbid_match" };
    }
  }

  // 2. Normalized name match.
  const normalizedPayload = normalizeName(payload.name);
  const nameMatches = candidates.filter(
    (c) => normalizeName(c.name) === normalizedPayload
  );

  if (nameMatches.length === 1) {
    const m = nameMatches[0]!;
    const payloadIsTribute = isLikelyTribute(payload.name);
    const candidateIsTribute = isLikelyTribute(m.name);
    if (payloadIsTribute !== candidateIsTribute) {
      // One side is a tribute, the other isn't. Almost certainly different
      // acts that happen to share a name fragment after normalization.
      return {
        confidence: "NEEDS_REVIEW",
        artistId: null,
        reason: "tribute_act",
      };
    }
    return {
      confidence: "PROBABLE",
      artistId: m.id,
      reason: "name_match_no_mbid",
    };
  }

  if (nameMatches.length > 1) {
    return {
      confidence: "NEEDS_REVIEW",
      artistId: null,
      reason: "multiple_artist_candidates",
    };
  }

  // 3. Tribute-vs-real ambiguity. If one side carries a tribute marker
  //    and the OTHER side's normalized name overlaps significantly (i.e.,
  //    the tribute-stripped "core" matches), this is the dangerous merge
  //    we want to never make silently.
  const payloadIsTribute = isLikelyTribute(payload.name);
  const payloadCore = stripTributeKeywords(payload.name);
  const tributeAmbiguous = candidates.find((c) => {
    const candidateIsTribute = isLikelyTribute(c.name);
    if (payloadIsTribute === candidateIsTribute) return false;
    const candidateCore = stripTributeKeywords(c.name);
    if (!payloadCore || !candidateCore) return false;
    return (
      payloadCore === candidateCore ||
      payloadCore.includes(candidateCore) ||
      candidateCore.includes(payloadCore)
    );
  });
  if (tributeAmbiguous) {
    return {
      confidence: "NEEDS_REVIEW",
      artistId: null,
      reason: "tribute_act",
    };
  }

  // 4. Fuzzy name match (>= FUZZY_THRESHOLD dice ratio). Never
  //    auto-resolves — the risk of merging two unrelated artists is too
  //    high. Capped at NEEDS_REVIEW so the admin queue handles it.
  const fuzzyMatches = candidates
    .map((c) => ({ c, ratio: fuzzyRatio(normalizedPayload, normalizeName(c.name)) }))
    .filter((x) => x.ratio >= FUZZY_THRESHOLD);

  if (fuzzyMatches.length > 0) {
    return {
      confidence: "NEEDS_REVIEW",
      artistId: null,
      reason: "artist_fuzzy",
    };
  }

  return { confidence: "NEW", artistId: null, reason: "no_artist_match" };
}

// ---------------------------------------------------------------------------
// Venue resolution
// ---------------------------------------------------------------------------

export type VenueCandidate = {
  id: string;
  name: string;
  city: string;
  externalRefs: Array<{ provider: string; providerVenueId: string }>;
};

export type VenuePayload = {
  id: string;       // setlist.fm venue id
  name: string;
  city: string;
};

const SETLISTFM_PROVIDER = "setlistfm";

export function resolveVenue(
  payload: VenuePayload,
  candidates: VenueCandidate[]
): VenueResolution {
  // 1. External-ref match. The strongest signal: we previously confirmed
  //    that this provider's venueId corresponds to this canonical Venue.
  for (const c of candidates) {
    if (
      c.externalRefs.some(
        (ref) =>
          ref.provider === SETLISTFM_PROVIDER &&
          ref.providerVenueId === payload.id
      )
    ) {
      return {
        confidence: "EXACT",
        venueId: c.id,
        reason: "external_ref_match",
      };
    }
  }

  // 2. Normalized name + city match. Strong, but not definitive — venue
  //    name conventions vary by source ("MSG" vs "Madison Square Garden").
  //    Cap at PROBABLE so admin confirms before we link providers.
  const normPayloadName = normalizeName(payload.name);
  const normPayloadCity = normalizeName(payload.city);
  const exactMatches = candidates.filter(
    (c) =>
      normalizeName(c.name) === normPayloadName &&
      normalizeName(c.city) === normPayloadCity
  );

  if (exactMatches.length === 1) {
    return {
      confidence: "PROBABLE",
      venueId: exactMatches[0]!.id,
      reason: "venue_name_city_match",
    };
  }
  if (exactMatches.length > 1) {
    return {
      confidence: "NEEDS_REVIEW",
      venueId: null,
      reason: "multiple_venue_candidates",
    };
  }

  // 3. Fuzzy name match within same city.
  const sameCityCandidates = candidates.filter(
    (c) => normalizeName(c.city) === normPayloadCity
  );
  const fuzzyMatches = sameCityCandidates
    .map((c) => ({
      c,
      ratio: fuzzyRatio(normPayloadName, normalizeName(c.name)),
    }))
    .filter((x) => x.ratio >= FUZZY_THRESHOLD);

  if (fuzzyMatches.length === 1) {
    return {
      confidence: "PROBABLE",
      venueId: fuzzyMatches[0]!.c.id,
      reason: "venue_fuzzy_match",
    };
  }
  if (fuzzyMatches.length > 1) {
    return {
      confidence: "NEEDS_REVIEW",
      venueId: null,
      reason: "multiple_venue_candidates",
    };
  }

  return { confidence: "NEW", venueId: null, reason: "no_venue_match" };
}

// ---------------------------------------------------------------------------
// Show resolution
// ---------------------------------------------------------------------------

export type ShowCandidate = {
  id: string;
  artistId: string;
  venueId: string;
  localDate: Date;
};

export type ShowResolveInput = {
  artistId: string;
  venueId: string;
  localDate: Date;
};

export function resolveShow(
  resolved: ShowResolveInput,
  candidates: ShowCandidate[]
): ShowResolution {
  // 1. Exact (artistId, venueId, localDate) — strongest signal.
  const exact = candidates.find(
    (c) =>
      c.artistId === resolved.artistId &&
      c.venueId === resolved.venueId &&
      sameUtcDay(c.localDate, resolved.localDate)
  );
  if (exact) {
    return {
      confidence: "EXACT",
      showId: exact.id,
      candidateShowIds: [],
      reason: "exact_match",
    };
  }

  // 2. Same artist + same date but a DIFFERENT venue → suspicious.
  //    Could be wrong venue resolution; could be a separate real show.
  //    Either way, do not auto-merge.
  const sameArtistSameDateDiffVenue = candidates.filter(
    (c) =>
      c.artistId === resolved.artistId &&
      sameUtcDay(c.localDate, resolved.localDate) &&
      c.venueId !== resolved.venueId
  );
  if (sameArtistSameDateDiffVenue.length > 0) {
    return {
      confidence: "NEEDS_REVIEW",
      showId: null,
      candidateShowIds: sameArtistSameDateDiffVenue.map((c) => c.id),
      reason: "different_venue_same_date",
    };
  }

  // 3. Same artist + same venue but date drifted ±1 day → probable.
  //    Timezone confusion or multi-night residency edge cases.
  const dateDrift = candidates.filter(
    (c) =>
      c.artistId === resolved.artistId &&
      c.venueId === resolved.venueId &&
      absDaysBetween(c.localDate, resolved.localDate) === 1
  );
  if (dateDrift.length > 0) {
    return {
      confidence: "PROBABLE",
      showId: null,
      candidateShowIds: dateDrift.map((c) => c.id),
      reason: "date_drift",
    };
  }

  return {
    confidence: "NEW",
    showId: null,
    candidateShowIds: [],
    reason: "no_show_match",
  };
}

// ---------------------------------------------------------------------------
// Top-level decision
// ---------------------------------------------------------------------------

export type MatchAction = "AUTO_MERGE" | "REVIEW" | "CREATE_NEW";

export type MatchDecision = {
  action: MatchAction;
  artistId: string | null;
  venueId: string | null;
  showId: string | null;
  candidateShowIds: string[];
  reason: string;
};

export function decideMatchAction(
  artist: ArtistResolution,
  venue: VenueResolution,
  show: ShowResolution
): MatchDecision {
  const reasons = [
    `artist:${artist.reason}`,
    `venue:${venue.reason}`,
    `show:${show.reason}`,
  ].join("|");

  // Any NEEDS_REVIEW → REVIEW. Defensive: never auto-merge when any
  // signal explicitly says "I'm not sure".
  if (
    artist.confidence === "NEEDS_REVIEW" ||
    venue.confidence === "NEEDS_REVIEW" ||
    show.confidence === "NEEDS_REVIEW"
  ) {
    return {
      action: "REVIEW",
      artistId: artist.artistId,
      venueId: venue.venueId,
      showId: null,
      candidateShowIds: show.candidateShowIds,
      reason: reasons,
    };
  }

  // All three EXACT → AUTO_MERGE. This is the ONLY path that mutates
  // an existing canonical Show.
  if (
    artist.confidence === "EXACT" &&
    venue.confidence === "EXACT" &&
    show.confidence === "EXACT"
  ) {
    return {
      action: "AUTO_MERGE",
      artistId: artist.artistId,
      venueId: venue.venueId,
      showId: show.showId,
      candidateShowIds: [],
      reason: reasons,
    };
  }

  // Any PROBABLE → REVIEW. We trust admins to confirm probable matches
  // rather than guessing on their behalf.
  if (
    artist.confidence === "PROBABLE" ||
    venue.confidence === "PROBABLE" ||
    show.confidence === "PROBABLE"
  ) {
    return {
      action: "REVIEW",
      artistId: artist.artistId,
      venueId: venue.venueId,
      showId: null,
      candidateShowIds: show.candidateShowIds,
      reason: reasons,
    };
  }

  // All remaining states are EXACT or NEW with no overlap signal.
  // Safe to create a new canonical Show.
  return {
    action: "CREATE_NEW",
    artistId: artist.artistId,
    venueId: venue.venueId,
    showId: null,
    candidateShowIds: [],
    reason: reasons,
  };
}
