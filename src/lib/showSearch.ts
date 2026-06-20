// Show search — pure handler over our canonical Show table.
//
// Lives separately from /shows/search (which is the Ticketmaster
// Discovery passthrough used during review-creation and now by the
// unified show-search frontend). This endpoint never hits any external
// API; results come straight from Postgres.
//
// The frontend fires this AND /shows/search in parallel and merges +
// re-ranks results client-side. We deliberately keep the backend dumb:
// it returns DB matches in a stable order (localDate DESC, id DESC) so
// the client can apply the recency-tier ranking without worrying about
// which page boundary it crossed.

import type { PrismaClient } from "@prisma/client";

export const MIN_SHOW_SEARCH_QUERY = 2;
export const DEFAULT_SHOW_SEARCH_LIMIT = 20;
export const MAX_SHOW_SEARCH_LIMIT = 100;

export type SearchShowsInput = {
  q: string;
  limit: number;
  cursor: Date | null;
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
  nextCursor: string | null;
};

export async function searchShows(
  input: SearchShowsInput,
  deps: { prisma: PrismaClient },
): Promise<SearchShowsResult> {
  const q = typeof input.q === "string" ? input.q.trim() : "";
  if (q.length < MIN_SHOW_SEARCH_QUERY) {
    return { items: [], nextCursor: null };
  }

  // Cursor on localDate DESC; cursor value is "fetch shows with
  // localDate strictly older than this". Ties on localDate are handled
  // by the secondary id DESC sort which makes pagination stable.
  const rows = await deps.prisma.show.findMany({
    where: {
      AND: [
        ...(input.cursor ? [{ localDate: { lt: input.cursor } }] : []),
        {
          OR: [
            {
              artist: {
                name: { contains: q, mode: "insensitive" as const },
              },
            },
            {
              venue: {
                name: { contains: q, mode: "insensitive" as const },
              },
            },
            {
              venue: {
                city: { contains: q, mode: "insensitive" as const },
              },
            },
          ],
        },
      ],
    },
    orderBy: [{ localDate: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    include: {
      artist: { select: { id: true, name: true } },
      venue: { select: { id: true, name: true, city: true } },
      _count: {
        select: {
          reviews: { where: { moderationStatus: { not: "BLOCKED" } } },
          attendances: true,
        },
      },
    },
  });

  const hasMore = rows.length > input.limit;
  const trimmed = hasMore ? rows.slice(0, input.limit) : rows;
  const items: ShowSearchItem[] = trimmed.map((r) => ({
    id: r.id,
    artist: r.artist,
    venue: r.venue,
    localDate: r.localDate,
    reviewCount: r._count.reviews,
    attendanceCount: r._count.attendances,
  }));

  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? last.localDate.toISOString() : null;

  return { items, nextCursor };
}
