// Ticketmaster ingestion orchestrator.
//
// Owns the WINDOW STRATEGY; the reconciliation itself belongs to the
// shared engine.
//
// Why slices: Discovery refuses to page past ~1,000 results, and the NYC
// music window holds ~1,800 events over 180 days. 30-day slices keep each
// query far under the cap (the busiest observed slice was 583 events, 3
// pages) and bound the per-run write volume against Vercel's 300s limit.
//
// Why "slice 0 plus one rotating far slice": event density collapses with
// distance — roughly 385 / 583 / 462 / 282 / 74 / 27 events across the six
// slices. The near window changes constantly (new announcements, time
// changes, cancellations) and is where reviewable shows come from, so it
// is refreshed every run. The far window barely moves, so it rotates and
// gets a full refresh weekly. A show would have to be announced AND played
// inside the rotation gap to be missed, which a 180-day lookahead makes
// essentially impossible.

import type { PrismaClient } from "@prisma/client";
import { fetchEventWindow, type TicketmasterClientDeps } from "./ticketmaster.js";
import { parseTicketmasterEvents, TICKETMASTER_PROVIDER } from "./ticketmasterParse.js";
import { ingestNormalizedEvents } from "./ingestEngine.js";
import { freshSummary, type IngestSummary } from "./ingestTypes.js";

/** New York DMA. Chosen for recall: the market is wider than "NYC", and
 *  over-ingesting a Hudson Valley show is free, while missing one is
 *  permanent. Geography is a product-layer question, not an ingest-time
 *  filter. */
export const NYC_DMA_ID = "345";

export const SLICE_DAYS = 30;
export const WINDOW_DAYS = 180;
export const SLICE_COUNT = WINDOW_DAYS / SLICE_DAYS; // 6

export type TicketmasterIngestDeps = {
  prisma: PrismaClient;
  now?: () => Date;
  client?: TicketmasterClientDeps;
  /** Explicit slices to run. Defaults to [0, rotating far slice]. */
  slices?: number[];
  /** Run every slice — used for the initial backfill. */
  allSlices?: boolean;
  maxWrites?: number;
  dmaId?: string;
};

export type TicketmasterRunSummary = IngestSummary & {
  slices: {
    index: number;
    startDateTime: string;
    endDateTime: string;
    fetched: number;
    totalElements: number;
    truncated: boolean;
  }[];
  apiRequests: number;
};

/** ISO without milliseconds — Discovery rejects the fractional form. */
function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function sliceWindow(base: Date, index: number): { start: Date; end: Date } {
  const start = new Date(base.getTime() + index * SLICE_DAYS * 86_400_000);
  const end = new Date(base.getTime() + (index + 1) * SLICE_DAYS * 86_400_000);
  return { start, end };
}

/**
 * Which slices this run covers. Slice 0 always; plus one far slice that
 * advances daily so 1..5 each get refreshed within a week.
 */
export function slicesForRun(now: Date, allSlices = false): number[] {
  if (allSlices) return Array.from({ length: SLICE_COUNT }, (_, i) => i);
  const dayIndex = Math.floor(now.getTime() / 86_400_000);
  const far = 1 + (dayIndex % (SLICE_COUNT - 1));
  return [0, far];
}

export async function runTicketmasterIngestion(
  deps: TicketmasterIngestDeps,
): Promise<TicketmasterRunSummary> {
  const now = deps.now ?? (() => new Date());
  const base = now();
  const dmaId = deps.dmaId ?? NYC_DMA_ID;
  const indices =
    deps.slices ?? slicesForRun(base, deps.allSlices ?? false);

  const summary: TicketmasterRunSummary = {
    ...freshSummary(TICKETMASTER_PROVIDER),
    slices: [],
    apiRequests: 0,
  };

  // Write budget is shared across slices so one run can't blow past the
  // function timeout by doing 6 full slices of writes.
  let remainingWrites = deps.maxWrites ?? 600;

  for (const index of indices) {
    const { start, end } = sliceWindow(base, index);
    const page = await fetchEventWindow(
      { dmaId, startDateTime: iso(start), endDateTime: iso(end) },
      deps.client ?? {},
    );
    summary.apiRequests += page.requests;

    const normalized = parseTicketmasterEvents(page.events);
    const result = await ingestNormalizedEvents(normalized, {
      prisma: deps.prisma,
      now,
      maxWrites: remainingWrites,
    });

    summary.slices.push({
      index,
      startDateTime: iso(start),
      endDateTime: iso(end),
      fetched: page.events.length,
      totalElements: page.totalElements,
      truncated: page.truncated,
    });

    summary.fetched += result.fetched;
    summary.created += result.created;
    summary.matched += result.matched;
    summary.updated += result.updated;
    summary.needsReview += result.needsReview;
    summary.errors += result.errors;
    for (const k of Object.keys(result.skipped) as (keyof typeof result.skipped)[]) {
      summary.skipped[k] += result.skipped[k];
    }
    if (result.budgetExhausted) summary.budgetExhausted = true;

    remainingWrites -= result.created + result.updated + result.matched;
    if (remainingWrites <= 0) {
      summary.budgetExhausted = true;
      break;
    }
  }

  return summary;
}
