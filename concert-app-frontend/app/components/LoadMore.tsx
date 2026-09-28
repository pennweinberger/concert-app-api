"use client";

// Quiet "Load more" control for paginated review/history lists, matching
// the pattern already established inside comment threads. Renders nothing
// once a list is exhausted, so the end of a list is simply the end of the
// page rather than a disabled dead control.
//
// Infinite scroll is deliberately not used: the feed is meant to be read,
// and each page costs a real round-trip.

export default function LoadMore({
  onClick,
  loading,
  error,
  label = "Load more",
}: {
  onClick: () => void;
  loading: boolean;
  /** Set when the previous attempt failed; swaps in a subdued retry. */
  error?: string | null;
  label?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
      <button
        onClick={onClick}
        disabled={loading}
        className="btn btn-outline"
      >
        {loading ? "Loading…" : error ? "Try again" : label}
      </button>
      {error && !loading && (
        <div style={{ color: "var(--danger)", fontSize: "13px" }}>{error}</div>
      )}
    </div>
  );
}
