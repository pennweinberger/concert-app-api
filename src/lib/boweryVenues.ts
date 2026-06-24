// Bowery / AEG NYC venue allowlist — v1.
//
// Strict allowlist: ONLY these 7 venues are ingested in v1. Every other
// event in the Bowery feed (Radio City, MSG, Beacon, Carnegie Hall,
// Knockdown Center, etc.) is skipped and counted in the run summary.
// We expand the allowlist explicitly after each venue's quality has
// been verified — never by ingesting the whole feed and pruning later.
//
// `venueId` is the primary filter (stable numeric string from the
// feed's `venue.venueId`). `title` is documentation + a fallback we
// could turn on if the venueId set ever changes upstream.

export type BoweryAllowlistEntry = {
  /** Stable numeric id from the feed's venue.venueId. Primary match key. */
  venueId: string;
  /** Feed venue.title — exact spelling. Used for diagnostics. */
  title: string;
};

export const BOWERY_NYC_ALLOWLIST: BoweryAllowlistEntry[] = [
  { venueId: "124944", title: "Forest Hills Stadium" },
  { venueId: "125705", title: "Terminal 5" },
  { venueId: "101385", title: "Webster Hall" },
  { venueId: "128735", title: "Racket" },
  { venueId: "125933", title: "Music Hall of Williamsburg" },
  { venueId: "126144", title: "Brooklyn Steel" },
  { venueId: "129142", title: "Under the K Bridge Park" },
];

export const BOWERY_NYC_ALLOWLIST_IDS: ReadonlySet<string> = new Set(
  BOWERY_NYC_ALLOWLIST.map((v) => v.venueId),
);

export function isAllowlistedVenueId(venueId: string | null | undefined): boolean {
  return typeof venueId === "string" && BOWERY_NYC_ALLOWLIST_IDS.has(venueId);
}
