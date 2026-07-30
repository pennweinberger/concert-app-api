"use client";

import Link from "next/link";

/**
 * Primary "write a review" call to action on the feed — the magenta banner
 * row from the mobile design.
 *
 * This is the app's one saturated accent, so it is deliberately the only
 * place magenta appears at full strength. When this row is on screen the
 * masthead's Write Review pill is suppressed (`<Masthead hideWriteReview />`)
 * so the same action is not offered twice.
 */

export default function WriteReviewRow() {
  return (
    <Link
      href="/review/new"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "14px",
        borderRadius: "14px",
        padding: "14px 16px",
        marginTop: "15px",
        textDecoration: "none",
        color: "#f4f1ea",
        fontSize: "16.5px",
        fontWeight: 500,
        border: "1px solid rgba(226,140,60,0.55)",
        background:
          "linear-gradient(100deg, rgba(120,40,90,0.30), rgba(60,20,80,0.20))",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: "34px",
          height: "34px",
          borderRadius: "50%",
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#e0219b",
          color: "#fff",
        }}
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
      <span>Write Review</span>
      <span
        aria-hidden="true"
        style={{ marginLeft: "auto", color: "#8f8f8f", display: "inline-flex" }}
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </span>
    </Link>
  );
}
