// Artist search — pure handler over our canonical Artist table.
//
// WHY THIS EXISTS: /artist/[id] pages were reachable only by finding a
// show first and clicking through. Nothing searched the Artist table —
// the header box matched artist NAMES but returned SHOWS, so an artist
// page was two non-obvious clicks away and an artist whose shows had
// scrolled out of reach was effectively unreachable.
//
// Deliberately separate from showSearch.ts rather than folded into it:
// show search behaviour is unchanged by this feature, and keeping the
// two apart means the existing showSearch tests are the regression
// guard for that promise.
//
// RESPONSE IS DELIBERATELY MINIMAL — { id, name } only. Counts are used
// for RANKING but never returned; the dropdown row shows just the name,
// so shipping anything else would be speculative payload.

import type { PrismaClient } from "@prisma/client";
import { activeMarketVenueFilter } from "./markets.js";
import { MIN_SHOW_SEARCH_QUERY } from "./showSearch.js";

/** One threshold for the whole search box — imported, not re-declared. */
export const MIN_ARTIST_SEARCH_QUERY = MIN_SHOW_SEARCH_QUERY;
export const DEFAULT_ARTIST_SEARCH_LIMIT = 5;
export const MAX_ARTIST_SEARCH_LIMIT = 20;

export type SearchArtistsInput = {
  q: string;
  limit: number;
};

export type ArtistSearchItem = {
  id: string;
  name: string;
};

export type SearchArtistsResult = {
  items: ArtistSearchItem[];
};

/**
 * Market scope. An artist qualifies when they have AT LEAST ONE show at
 * a venue in an active market — past or upcoming, deliberately.
 *
 * Past counts because past shows are exactly what people review: there
 * is no date cutoff on review creation, only the market gate. An artist
 * who played here last month has a useful page.
 *
 * Artists with no in-market show are excluded entirely. Their page would
 * be empty and every show on it unreviewable, so the row would be a
 * dead end — worse than returning nothing.
 */
const IN_MARKET: object = {
  shows: { some: { venue: activeMarketVenueFilter() } },
};

export async function searchArtists(
  input: SearchArtistsInput,
  deps: { prisma: PrismaClient },
): Promise<SearchArtistsResult> {
  const q = typeof input.q === "string" ? input.q.trim() : "";
  if (q.length < MIN_ARTIST_SEARCH_QUERY) {
    return { items: [] };
  }

  const limit = input.limit;

  // Ranking is exact → prefix → substring. Prisma cannot ORDER BY a
  // CASE expression, and sorting a single `contains` page in JS would be
  // WRONG, not merely slower: with more matches than the page size, an
  // exact match can sit outside the fetched window and never be seen.
  //
  // Three narrow queries give the tiers exactly. Each is bounded by
  // `take: limit` (<= MAX_ARTIST_SEARCH_LIMIT), so the upper bound is
  // small and the work is three indexed lookups.
  //
  // NOTE: DATABASE_URL pins connection_limit=1, so these serialise even
  // inside Promise.all. That is acceptable for a type-ahead returning a
  // handful of rows, and it is the same trade showSearch.ts already
  // makes with its two range scans.
  //
  // `mode: "insensitive"` is load-bearing: Artist.name is still a
  // case-SENSITIVE unique column, so "kaytranada" must match the stored
  // "KAYTRANADA". Search must not inherit that bug.
  const select = { id: true, name: true };
  const orderBy = [{ name: "asc" as const }, { id: "asc" as const }];

  const tier = (where: object) =>
    deps.prisma.artist.findMany({
      where: { AND: [IN_MARKET, where] },
      select,
      orderBy,
      take: limit,
    });

  const [exact, prefix, substring] = await Promise.all([
    tier({ name: { equals: q, mode: "insensitive" } }),
    tier({ name: { startsWith: q, mode: "insensitive" } }),
    tier({ name: { contains: q, mode: "insensitive" } }),
  ]);

  // Concatenation order IS the ranking. Dedupe keeps the first
  // occurrence, so an exact match that also matches the prefix and
  // substring tiers stays at the top rather than appearing three times.
  const seen = new Set<string>();
  const items: ArtistSearchItem[] = [];
  for (const row of [...exact, ...prefix, ...substring]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    items.push({ id: row.id, name: row.name });
    if (items.length >= limit) break;
  }

  return { items };
}
