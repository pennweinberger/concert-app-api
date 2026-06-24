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
  /**
   * Optional per-venue feed id. Only set when the venue's events are
   * NOT fully represented in the regional /events/59/ feed (e.g.,
   * multi-promoter venues like Forest Hills Stadium). Skipping the
   * per-venue fetch for venues where the regional feed is canonical
   * saves an HTTP roundtrip per cron run.
   */
  perVenueFeedId?: string;
};

export const BOWERY_NYC_ALLOWLIST: BoweryAllowlistEntry[] = [
  // Forest Hills is multi-promoter — supplement the regional feed with
  // /events/58/ which is the venue's complete calendar (includes shows
  // promoted by Live Nation, Madison House, etc. — e.g., the Hayley
  // Williams Show is in /events/58/ but NOT in /events/59/).
  { venueId: "124944", title: "Forest Hills Stadium", perVenueFeedId: "58" },
  // Bowery Presents primary venues — regional feed is canonical (their
  // own pages on bowerypresents.com point at /events/59/ themselves).
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
