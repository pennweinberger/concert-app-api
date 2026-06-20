// Curated NYC DICE venue seed list — Phase 1.
//
// Each entry maps one canonical Venue (name + city) to one or more DICE
// venue short ids. Sibling rooms (e.g., Elsewhere main / Hall / Rooftop)
// collapse to the same canonical Venue via multiple `VenueExternalRef`
// rows. The DICE short id is the primary lookup key in resolveVenue, so
// variant naming and sibling-room enumeration are handled transparently.
//
// To add a new venue: verify the DICE short id at
// https://dice.fm/venue/<shortId> returns the expected JSON-LD, then add
// an entry below. The ingestion cron will pick it up on the next run.

export type DiceSeedVenue = {
  canonicalName: string;
  city: string;
  diceShortIds: string[];
};

export const DICE_NYC_VENUES: DiceSeedVenue[] = [
  // ── Williamsburg / Bushwick / Ridgewood ────────────────────────────
  {
    canonicalName: "Elsewhere",
    city: "Brooklyn",
    diceShortIds: ["8p85", "6p32", "a2bq"], // main / The Hall / Rooftop
  },
  {
    canonicalName: "Public Records",
    city: "Brooklyn",
    diceShortIds: ["w2qg"],
  },
  {
    canonicalName: "Knockdown Center",
    city: "Maspeth",
    diceShortIds: ["e776", "owog"], // main / Ruins
  },
  {
    canonicalName: "Market Hotel",
    city: "Brooklyn",
    diceShortIds: ["kvxl"],
  },
  {
    canonicalName: "Bossa Nova Civic Club",
    city: "Brooklyn",
    diceShortIds: ["3odkl"],
  },
  {
    canonicalName: "The Brooklyn Monarch",
    city: "Brooklyn",
    diceShortIds: ["nq69"],
  },
  {
    canonicalName: "Signal",
    city: "Brooklyn",
    diceShortIds: ["8ee9w"],
  },
  {
    canonicalName: "Industry City",
    city: "Brooklyn",
    diceShortIds: ["g59xa"],
  },
  {
    canonicalName: "Pacha New York",
    city: "Brooklyn",
    diceShortIds: ["6dvb7"],
  },
  {
    canonicalName: "Brooklyn Storehouse",
    city: "Brooklyn",
    diceShortIds: ["ronv"],
  },
  {
    canonicalName: "Brooklyn Army Terminal",
    city: "Brooklyn",
    diceShortIds: ["r9rq", "l8lwp"], // Pier 4 / Full Waterfront
  },
  {
    canonicalName: "H0L0",
    city: "Queens",
    diceShortIds: ["oowy"],
  },
  {
    canonicalName: "Marquee New York",
    city: "New York",
    diceShortIds: ["qqwy"],
  },
  {
    canonicalName: "SILO Brooklyn",
    city: "Brooklyn",
    diceShortIds: ["eb72"],
  },
  {
    canonicalName: "The Summer Club",
    city: "Queens",
    diceShortIds: ["yadx"],
  },
  {
    canonicalName: "Superior Ingredients",
    city: "Brooklyn",
    diceShortIds: ["van6", "l2mb", "57qk"], // Main / Roof / Roof+Room
  },
  {
    canonicalName: "99 Scott",
    city: "Brooklyn",
    diceShortIds: ["ba7o", "2q6p"], // Main / Inner Space
  },
  {
    canonicalName: "Basement",
    city: "Maspeth",
    diceShortIds: ["wlvn"], // intentionally NOT collapsed into Knockdown — distinct programming
  },
  {
    canonicalName: "The Sultan Room",
    city: "Brooklyn",
    diceShortIds: ["e27w", "x57a"], // main / Rooftop
  },
];

// Deferred from v1 — flagged here so future passes can pick them up:
//   - Nowadays (Ridgewood) — not surfaced as a DICE venue
//   - Mansions (Brooklyn) — not surfaced as a DICE venue
//   - Brooklyn Made — DICE partner but no canonical /venue/ slug found
//   - Nebula (Times Square) — not on DICE; uses Fever/Tablelist/etc.

export function flattenedDiceShortIds(): string[] {
  return DICE_NYC_VENUES.flatMap((v) => v.diceShortIds);
}

// Map a DICE short id back to the canonical venue (name, city) it should
// resolve to. Used by the ingestion orchestrator to pass canonical
// (name, city) into resolveVenue alongside the DICE id, ensuring sibling
// rooms collapse onto one Venue from the very first call.
export function canonicalForDiceShortId(
  shortId: string,
): { canonicalName: string; city: string } | null {
  for (const v of DICE_NYC_VENUES) {
    if (v.diceShortIds.includes(shortId)) {
      return { canonicalName: v.canonicalName, city: v.city };
    }
  }
  return null;
}
