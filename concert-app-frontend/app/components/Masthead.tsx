"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { clearSession, useAuthUser } from "../lib/auth";
import NotificationBell from "./NotificationBell";
import ProfileMenu from "./ProfileMenu";

// Shared site masthead (Phase 1 design, extracted in Phase 2 so the
// homepage and show page share one navigation). Desktop (>768px): full
// link row. Mobile / narrow tablet: compact row (Write Review, bell,
// avatar) with secondary destinations inside ProfileMenu. The
// masthead-nav-* classes live in globals.css.

const navLinkStyle: CSSProperties = {
  color: "#8f8f8f",
  textDecoration: "none",
  fontSize: "14px",
};

const navButtonStyle: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: "#8f8f8f",
  cursor: "pointer",
  fontSize: "14px",
  fontFamily: "inherit",
};

const writeReviewPillStyle: CSSProperties = {
  color: "#f4f1ea",
  fontSize: "13.5px",
  fontWeight: 500,
  border: "1px solid #333",
  borderRadius: "8px",
  padding: "6px 12px",
  textDecoration: "none",
};

export default function Masthead({
  /**
   * Suppress the Write Review pill. Set by surfaces that already show the
   * magenta WriteReviewRow, so the same action is not offered twice. Other
   * pages keep the pill as their only path to the review flow — do not
   * remove it from here without giving those pages a replacement.
   */
  hideWriteReview = false,
}: {
  hideWriteReview?: boolean;
} = {}) {
  const authUser = useAuthUser();

  return (
    <header
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "12px",
        marginBottom: "26px",
      }}
    >
      <Link
        href="/"
        style={{
          fontSize: "19px",
          fontWeight: 600,
          letterSpacing: "-0.01em",
          color: "#f4f1ea",
          textDecoration: "none",
        }}
      >
        Afterset
      </Link>

      {/* Desktop: full link row. */}
      <nav className="masthead-nav-desktop" aria-label="Primary">
        {!hideWriteReview && (
          <Link href="/review/new" style={writeReviewPillStyle}>
            Write Review
          </Link>
        )}
        {authUser ? (
          <>
            {authUser.isAdmin && (
              <Link
                href="/admin/moderation"
                style={{ ...navLinkStyle, color: "#ff8080" }}
              >
                Admin
              </Link>
            )}
            <Link href="/people" style={navLinkStyle}>
              Find Users
            </Link>
            <NotificationBell />
            <Link href={`/user/${authUser.handle}`} style={navLinkStyle}>
              Profile
            </Link>
            <Link href="/settings" style={navLinkStyle}>
              Settings
            </Link>
            <button onClick={() => clearSession()} style={navButtonStyle}>
              Sign out
            </button>
          </>
        ) : (
          <>
            <Link href="/signin" style={navLinkStyle}>
              Sign in
            </Link>
            <Link href="/signup" style={navLinkStyle}>
              Sign up
            </Link>
          </>
        )}
      </nav>

      {/* Mobile / narrow tablet: compact row + profile menu. */}
      <div className="masthead-nav-compact" aria-label="Primary">
        {!hideWriteReview && (
          <Link href="/review/new" style={writeReviewPillStyle}>
            Write Review
          </Link>
        )}
        {authUser ? (
          <>
            <NotificationBell />
            <ProfileMenu
              handle={authUser.handle}
              isAdmin={!!authUser.isAdmin}
            />
          </>
        ) : (
          <>
            <Link href="/signin" style={navLinkStyle}>
              Sign in
            </Link>
            <Link href="/signup" style={navLinkStyle}>
              Sign up
            </Link>
          </>
        )}
      </div>
    </header>
  );
}
