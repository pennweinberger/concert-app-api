// Show search — pure handler over our canonical Show table.
//
// Lives separately from /shows/search (which is the Ticketmaster
// Discovery passthrough used during review-creation and now by the
// unified show-search frontend). This endpoint never hits any external
// API; results come straight from Postgres.
//
// ORDERING: nearest to today first, in BOTH directions.
//
// This used to be a single `localDate DESC` scan, which was wrong in a
// way that only shows up with real data. Ingestion (DICE / Bowery /
// Ticketmaster) fills the table with UPCOMING events, so "newest first"
// really means "furthest into the future first" — a query with more
// matches than `limit` filled the entire page with future shows and
// never reached the past at all. Reviews are written about shows that
// already happened, so the one thing the search had to surface was the
// one thing it structurally could not.
//
// Ticketmaster cannot cover for this: its Discovery API returns nothing
// for a past date window, so our own table is the only source of
// recently-played shows. Hence the two-directional scan below.

import type { PrismaClient } from "@prisma/client";
import { NOT_BLOCKED_COUNT } from "./moderation.js";
import { activeMarketVenueFilter } from "./markets.js";

export const MIN_SHOW_SEARCH_QUERY = 2;
export const DEFAULT_SHOW_SEARCH_LIMIT = 20;
export const MAX_SHOW_SEARCH_LIMIT = 100;

export type SearchShowsInput = {
  q: string;
  limit: number;
  /** Reference point for "nearest". Injectable so tests are deterministic. */
  now?: Date;
};

export type ShowSearchItem = {
  id: string;
  artist: { id: string; name: string };
  venue: { id: string; name: string; city: string };
  localDate: Date;
  reviewCount: number;
  attendanceCount: number;
};

export type SearchShowsResult = {
  items: ShowSearchItem[];
};

export async function searchShows(
  input: SearchShowsInput,
  deps: { prisma: PrismaClient },
): Promise<SearchShowsResult> {
  const q = typeof input.q === "string" ? input.q.trim() : "";
  if (q.length < MIN_SHOW_SEARCH_QUERY) {
    return { items: [] };
  }

  const now = input.now ?? new Date();

  // Market scope. Ingestion still pulls the whole New York DMA and we
  // never delete anything, so out-of-market shows stay in the database —
  // they are simply not discoverable while their venue sits outside an
  // active market. Promoting a venue later makes its whole back catalogue
  // appear at once.
  const matches = {
    AND: [
      { venue: activeMarketVenueFilter() },
      {
        OR: [
          { artist: { name: { contains: q, mode: "insensitive" as const } } },
          { venue: { name: { contains: q, mode: "insensitive" as const } } },
          { venue: { city: { contains: q, mode: "insensitive" as const } } },
        ],
      },
    ],
  };

  const shared = {
    take: input.limit,
    include: {
      artist: { select: { id: true, name: true } },
      venue: { select: { id: true, name: true, city: true } },
      _count: {
        select: {
          reviews: NOT_BLOCKED_COUNT,
          attendances: true,
        },
      },
    },
  };

  // Two indexed range scans rather than one ordered by a computed
  // distance: Prisma cannot order on an expression, and dropping to raw
  // SQL would mean hand-rolling the joins and the BLOCKED-filtered
  // review count. Taking `limit` from each side and then trimming keeps
  // the result correct when one side is empty (an artist who has only
  // ever played in the past still fills the page).
  //
  // NOTE: DATABASE_URL pins connection_limit=1, so Promise.all does NOT
  // run these concurrently — they serialise on the single connection.
  // It is written this way for readability, not for speed; the cost of
  // this endpoint is 2 queries rather than 1.
  const [past, upcoming] = await Promise.all([
    deps.prisma.show.findMany({
      where: { AND: [{ localDate: { lte: now } }, matches] },
      orderBy: [{ localDate: "desc" }, { id: "desc" }],
      ...shared,
    }),
    deps.prisma.show.findMany({
      where: { AND: [{ localDate: { gt: now } }, matches] },
      orderBy: [{ localDate: "asc" }, { id: "asc" }],
      ...shared,
    }),
  ]);

  const distance = (d: Date) => Math.abs(d.getTime() - now.getTime());

  const items: ShowSearchItem[] = [...past, ...upcoming]
    .sort((a, b) => {
      const d = distance(a.localDate) - distance(b.localDate);
      // id tie-break keeps the order deterministic when a past and an
      // upcoming show sit the same distance from today.
      return d !== 0 ? d : b.id.localeCompare(a.id);
    })
    .slice(0, input.limit)
    .map((r) => ({
      id: r.id,
      artist: r.artist,
      venue: r.venue,
      localDate: r.localDate,
      reviewCount: r._count.reviews,
      attendanceCount: r._count.attendances,
    }));

  return { items };
}
