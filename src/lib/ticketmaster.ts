// Ticketmaster Discovery API client.
//
// Two hard limits shape this file, both verified against the live API:
//
//   1. DEEP PAGING CAP. `page * size` must stay under 1000 — page 9 at
//      size 200 returns "Max paging depth exceeded". The NYC music window
//      holds ~1,800 events over 180 days, so a single query CANNOT read
//      them all. The caller must partition (we slice by date) and this
//      client refuses to page past the cap rather than looping into an
//      error.
//
//   2. QUOTA. 5,000 requests/day, reported back in the `rate-limit`
//      response headers. Our steady-state run costs ~5 requests, so this
//      is not a real constraint — but the headers are surfaced so a
//      future provider can react if that ever changes.

export class TicketmasterDisabledError extends Error {
  constructor() {
    super("Ticketmaster ingestion disabled or unconfigured");
    this.name = "TicketmasterDisabledError";
  }
}

export class TicketmasterFetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TicketmasterFetchError";
  }
}

const BASE = "https://app.ticketmaster.com/discovery/v2/events.json";
const USER_AGENT = "Afterset-IngestionBot/1.0 (+https://afterset.fm)";

/** Discovery rejects (page * size) >= 1000. */
export const MAX_PAGING_DEPTH = 1000;
export const PAGE_SIZE = 200;

/** Politeness delay between pages. The quota is generous; hammering isn't. */
const THROTTLE_MS = 250;

export type TicketmasterPage = {
  events: any[];
  page: { number: number; size: number; totalElements: number; totalPages: number };
};

export type FetchWindowInput = {
  /** Ticketmaster DMA. 345 = New York. */
  dmaId: string;
  startDateTime: string; // ISO, no milliseconds
  endDateTime: string;
};

export type TicketmasterClientDeps = {
  apiKey?: string;
  enabled?: boolean;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

function assertConfigured(deps: TicketmasterClientDeps): string {
  const key = deps.apiKey ?? process.env.TICKETMASTER_API_KEY;
  const enabled =
    deps.enabled ?? process.env.TICKETMASTER_INGEST_ENABLED === "true";
  if (!key || !enabled) throw new TicketmasterDisabledError();
  return key;
}

/**
 * Read one date window to exhaustion, stopping at the paging cap.
 *
 * Returns the raw events plus `truncated`, which is the signal that the
 * window held more than the API will serve — the caller's answer is a
 * narrower slice, not a bigger page.
 */
export async function fetchEventWindow(
  input: FetchWindowInput,
  deps: TicketmasterClientDeps = {},
): Promise<{ events: any[]; totalElements: number; truncated: boolean; requests: number }> {
  const key = assertConfigured(deps);
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const events: any[] = [];
  let page = 0;
  let totalElements = 0;
  let truncated = false;
  let requests = 0;

  for (;;) {
    if ((page + 1) * PAGE_SIZE > MAX_PAGING_DEPTH && page > 0) {
      // Next page would cross the cap. Stop cleanly.
      truncated = true;
      break;
    }

    const url =
      `${BASE}?classificationName=music` +
      `&dmaId=${encodeURIComponent(input.dmaId)}` +
      `&startDateTime=${encodeURIComponent(input.startDateTime)}` +
      `&endDateTime=${encodeURIComponent(input.endDateTime)}` +
      `&size=${PAGE_SIZE}&page=${page}&sort=date,asc` +
      `&apikey=${key}`;

    const res = await doFetch(url, { headers: { "User-Agent": USER_AGENT } });
    requests++;
    if (!res.ok) {
      throw new TicketmasterFetchError(
        `Ticketmaster returned ${res.status}`,
        res.status,
      );
    }
    const body = (await res.json()) as any;
    if (body?.errors) {
      throw new TicketmasterFetchError(
        body.errors?.[0]?.detail ?? "Ticketmaster error response",
      );
    }

    const batch: any[] = body?._embedded?.events ?? [];
    totalElements = body?.page?.totalElements ?? totalElements;
    events.push(...batch);

    const totalPages = body?.page?.totalPages ?? 0;
    page++;
    if (batch.length === 0 || page >= totalPages) break;
    await sleep(THROTTLE_MS);
  }

  if (totalElements > events.length) truncated = true;
  return { events, totalElements, truncated, requests };
}
