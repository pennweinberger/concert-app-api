// Context-aware show date: "Sep 4" for shows in the current calendar
// year, "Sep 4, 2024" for prior years — so recent shows stay compact
// but older ones aren't ambiguous. Uses the same local-time
// interpretation the feed has always used for display consistency.
export function formatShowDate(
  iso: string,
  opts: { longMonth?: boolean } = {},
): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const month = opts.longMonth ? "long" : "short";
  return d.toLocaleDateString(undefined, {
    month,
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
