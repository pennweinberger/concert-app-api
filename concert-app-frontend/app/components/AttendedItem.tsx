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
    <article id={`attended-${show.id}`} style={{ scrollMarginTop: "88px" }}>
      <h3
        style={{
          margin: 0,
          fontSize: "clamp(22px, 2.4vw, 26px)",
          fontWeight: 700,
          letterSpacing: "-0.035em",
          lineHeight: 1.1,
        }}
      >
        <Link href={`/show/${show.id}`} className="link-quiet">
          {show.artist.name}
        </Link>
      </h3>

      {/* Attendance state, where a rating would be. */}
      <div
        className="meta"
        style={{
          marginTop: "12px",
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ display: "block" }}
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
        Attended
      </div>

      <div
        style={{
          fontSize: "15px",
          fontWeight: 500,
          color: "var(--ink-2)",
          marginTop: "12px",
        }}
      >
        {show.venue.name}
      </div>
      <div className="meta" style={{ marginTop: "2px" }}>
        {formatShowDate(show.localDate, { longMonth: true })}
      </div>

      {isOwner && (
        <div style={{ marginTop: "16px" }}>
          <Link
            href={`/review/new?showId=${show.id}`}
            className="btn btn-outline btn-sm"
          >
            Write a review
          </Link>
        </div>
      )}
    </article>
  );
}
