// Market definitions and the single place product surfaces ask
// "is this in an active market?".
//
// A market is an Afterset-defined DISCOVERY SCOPE, not a municipal
// boundary. "NYC" means the New York concert ecosystem, which is why it
// deliberately contains New Jersey and Long Island venues.
//
// Markets never restrict INGESTION. We keep ingesting the whole New York
// DMA and never delete out-of-market data — a venue can be promoted into
// a market later and its history is already there.

import type { PrismaClient, Prisma } from "@prisma/client";

export const NYC_SLUG = "nyc";

/**
 * City strings that ARE New York City.
 *
 * Providers routinely send a neighbourhood where a city belongs —
 * "Maspeth" and "Forest Hills" are Queens, "Astoria" is Queens. Without
 * these, Knockdown Center and Forest Hills Stadium would look like
 * out-of-market venues.
 *
 * Used for two things: proposing the seed classification, and deciding
 * whether a user-submitted venue auto-qualifies. In both cases it only
 * ever PROPOSES — the stored VenueMarket row is the truth.
 */
export const NYC_BOROUGH_CITIES: readonly string[] = [
  "new york",
  "new york city",
  "manhattan",
  "brooklyn",
  "queens",
  "bronx",
  "the bronx",
  "staten island",
  // Queens neighbourhoods providers emit as a city
  "astoria",
  "corona",
  "elmhurst",
  "far rockaway",
  "flushing",
  "forest hills",
  "jamaica",
  "long island city",
  "maspeth",
  "rego park",
  "ridgewood",
  "rockaway beach",
  "sunnyside",
  "woodside",
  // Brooklyn neighbourhoods
  "coney island",
  "williamsburg",
  "greenpoint",
  "bushwick",
];

/**
 * Venues inside the NYC concert ecosystem but outside the city limits.
 * Curated by hand and signed off by the product owner — this list is the
 * whole reason markets exist rather than a radius or a DMA lookup.
 */
export const NYC_ECOSYSTEM_VENUE_NAMES: readonly string[] = [
  "MetLife Stadium",
  "Prudential Center",
  "UBS Arena",
  "Sports Illustrated Stadium",
  "The Wellmont Theater",
  "New Jersey Performing Arts Center",
  "The Capitol Theatre",
  "Garcia's at The Capitol Theatre",
  "The Paramount in concert with Northwell",
  "Northwell at Jones Beach Theater",
  "Nassau Veterans Memorial Coliseum",
  "Flagstar at Westbury Music Fair",
  "The Space at Westbury Theater",
  // Rooms inside venues already on this list. Kept together so one
  // physical site never straddles the market boundary.
  "Bay Stage at Northwell at Jones Beach Theater",
  "Spotlight at The Paramount",
];

export function normalizeCity(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Does a (city, state) pair place a venue in the five boroughs? */
export function isFiveBoroughs(
  city: string | null | undefined,
  state: string | null | undefined,
): boolean {
  const c = normalizeCity(city);
  if (!NYC_BOROUGH_CITIES.includes(c)) return false;
  // "New York" exists in several states; require NY when a state is given.
  const st = (state ?? "").trim().toUpperCase();
  return st === "" || st === "NY";
}

/**
 * THE filter for every market-scoped query.
 *
 * Everything product-facing goes through this one helper, so the storage
 * shape (currently the VenueMarket join) is not assumed across the
 * codebase. Swapping it later touches this function only.
 */
export function activeMarketVenueFilter(): Prisma.VenueWhereInput {
  return { markets: { some: { market: { isActive: true } } } };
}

/** Same predicate, expressed from a Show. */
export function activeMarketShowFilter(): Prisma.ShowWhereInput {
  return { venue: activeMarketVenueFilter() };
}

/** Is this specific show reviewable right now? */
export async function isShowInActiveMarket(
  showId: string,
  deps: { prisma: PrismaClient },
): Promise<boolean> {
  const hit = await deps.prisma.show.findFirst({
    where: { id: showId, ...activeMarketShowFilter() },
    select: { id: true },
  });
  return hit !== null;
}
