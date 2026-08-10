// Ticketmaster event → NormalizedEvent.
//
// This is the only file in the ingestion path that knows Ticketmaster's
// JSON shape. Everything downstream sees the neutral type.

import {
  normalizeText,
  type NormalizedEvent,
  type ShowStatus,
} from "./ingestTypes.js";

export const TICKETMASTER_PROVIDER = "ticketmaster";

/**
 * Discovery `dates.status.code` → our status.
 *
 * Only an explicit code moves a show off "scheduled". "offsale" means
 * tickets stopped selling (sold out, or the show has passed) and says
 * nothing about whether it happens, so it maps to scheduled.
 */
export function mapStatus(code: string | null | undefined): ShowStatus {
  switch ((code ?? "").toLowerCase()) {
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "postponed":
      return "postponed";
    case "rescheduled":
      return "rescheduled";
    default:
      return "scheduled";
  }
}

/**
 * UTC midnight of the provider's LOCAL calendar date.
 *
 * The Show natural key uses localDate, so it has to be a stable,
 * timezone-independent value. Parsing "2026-08-05" as UTC midnight gives
 * that; using the event's exact instant would shift the key across
 * timezones and split one night into two rows.
 */
export function localDateToUtcMidnight(localDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate ?? "")) return null;
  const d = new Date(`${localDate}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseTicketmasterEvent(raw: any): NormalizedEvent | null {
  const providerEventId = normalizeText(raw?.id);
  if (!providerEventId) return null;

  const localDateStr = raw?.dates?.start?.localDate;
  const localDate = localDateToUtcMidnight(localDateStr);
  if (!localDate) return null;

  // The performing artist is the first ATTRACTION. `event.name` is the
  // tour/event title ("Hilary Duff: The Lucky Me Tour", or worse
  // "Madison Square Garden Tour Experience"), so falling back to it would
  // manufacture junk artists. ~3% of music events carry no attraction;
  // those are returned with an empty artist name and dropped by the
  // engine, which counts them as missingArtist.
  const attraction = raw?._embedded?.attractions?.[0];
  const venue = raw?._embedded?.venues?.[0];

  const startIso = raw?.dates?.start?.dateTime;
  const startDatetimeUtc = startIso ? new Date(startIso) : null;

  return {
    provider: TICKETMASTER_PROVIDER,
    providerEventId,
    artist: {
      name: normalizeText(attraction?.name),
      providerId: normalizeText(attraction?.id) || null,
    },
    venue: {
      name: normalizeText(venue?.name),
      city: normalizeText(venue?.city?.name),
      state: normalizeText(venue?.state?.stateCode) || null,
      country: normalizeText(venue?.country?.countryCode) || null,
      providerId: normalizeText(venue?.id) || null,
      timezone: normalizeText(raw?.dates?.timezone) || null,
    },
    startDatetimeUtc:
      startDatetimeUtc && !Number.isNaN(startDatetimeUtc.getTime())
        ? startDatetimeUtc
        : null,
    localDate,
    timezone: normalizeText(raw?.dates?.timezone) || null,
    status: mapStatus(raw?.dates?.status?.code),
    raw: {
      // Trimmed payload. The full Discovery event is several KB of
      // images and price ranges we will never read; keeping the fields
      // that aid debugging avoids bloating the table by ~1,800 rows.
      id: raw?.id,
      name: raw?.name,
      url: raw?.url,
      localDate: localDateStr,
      statusCode: raw?.dates?.status?.code,
      venue: venue?.name,
      city: venue?.city?.name,
      attraction: attraction?.name,
    },
  };
}

export function parseTicketmasterEvents(rawEvents: any[]): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];
  for (const raw of rawEvents ?? []) {
    const parsed = parseTicketmasterEvent(raw);
    if (parsed) out.push(parsed);
  }
  return out;
}
