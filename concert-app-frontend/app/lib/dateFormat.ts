// Show dates are calendar dates, not instants. The API stores each one as
// midnight UTC (see localDateToUtcMidnight in src/lib/ticketmasterParse.ts)
// and Ticketmaster search returns a bare "YYYY-MM-DD", which Date also
// parses as midnight UTC. Formatting must therefore happen in UTC: in local
// time, every viewer west of UTC saw each show one day early.
//
// Default output is context-aware: "Sep 4" for shows in the current
// calendar year, "Sep 4, 2024" for prior years — so recent shows stay
// compact but older ones aren't ambiguous.
export function formatShowDate(
  iso: string,
  opts: {
    longMonth?: boolean;
    /** Prefix the weekday ("Thu, Sep 24, 2026"). */
    weekday?: boolean;
    /** Include the year even for current-year shows. */
    alwaysYear?: boolean;
  } = {},
): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const sameYear = d.getUTCFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: opts.longMonth ? "long" : "short",
    day: "numeric",
    ...(opts.weekday ? { weekday: "short" } : {}),
    ...(sameYear && !opts.alwaysYear ? {} : { year: "numeric" }),
  });
}
