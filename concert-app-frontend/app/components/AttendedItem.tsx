"use client";

import Link from "next/link";
import { formatShowDate } from "../lib/dateFormat";

// Attended-only entry in a profile's concert history: a show the person
// marked attended but hasn't reviewed. Structurally the same object as a
// reviewed entry (artist headline -> state -> venue -> date) but quieter,
// with the rating/prose replaced by a muted "Attended" state.
//
// The owner gets a subdued "Write a review" action so marking attendance
// has an obvious path to finishing the review later. Visitors see the
// entry as purely informational.

export type AttendedItemShow = {
  id: string;
  localDate: string;
  artist: { id: string; name: string };
  venue: { name: string; city: string };
};

export default function AttendedItem({
  show,
  isOwner,
}: {
  show: AttendedItemShow;
  isOwner: boolean;
}) {
  return (
    <article id={`attended-${show.id}`} style={{ scrollMarginTop: "24px" }}>
      <h3
        style={{
          margin: 0,
          fontSize: "24px",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
        }}
      >
        <Link
          href={`/show/${show.id}`}
          style={{ color: "#f4f1ea", textDecoration: "none" }}
        >
          {show.artist.name}
        </Link>
      </h3>

      {/* Attendance state, where a rating would be. */}
      <div
        style={{
          fontSize: "13px",
          color: "#7a7a7a",
          marginTop: "11px",
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ display: "block" }}
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
        Attended
      </div>

      <div style={{ fontSize: "14px", color: "#8a8a8a", marginTop: "13px" }}>
        {show.venue.name}
      </div>
      <div style={{ fontSize: "13.5px", color: "#6f6f6f", marginTop: "1px" }}>
        {formatShowDate(show.localDate, { longMonth: true })}
      </div>

      {isOwner && (
        <div style={{ marginTop: "13px" }}>
          <Link
            href={`/review/new?showId=${show.id}`}
            style={{
              display: "inline-block",
              fontSize: "13px",
              color: "#8a8a8a",
              border: "1px solid #2e2e2e",
              borderRadius: "8px",
              padding: "6px 12px",
              textDecoration: "none",
            }}
          >
            Write a review
          </Link>
        </div>
      )}
    </article>
  );
}
