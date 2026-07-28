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
    <div style={{ paddingTop: "8px" }}>
      <button
        onClick={onClick}
        disabled={loading}
        style={{
          background: "transparent",
          border: "1px solid #2e2e2e",
          borderRadius: "8px",
          color: loading ? "#5a5a5a" : "#8a8a8a",
          fontSize: "13px",
          fontFamily: "inherit",
          padding: "8px 14px",
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Loading…" : error ? "Try again" : label}
      </button>
      {error && !loading && (
        <div style={{ color: "#8a6a6a", fontSize: "12px", marginTop: "6px" }}>
          {error}
        </div>
      )}
    </div>
  );
}
