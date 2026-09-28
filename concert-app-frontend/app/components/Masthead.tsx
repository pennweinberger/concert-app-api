"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthUser } from "../lib/auth";
import NotificationBell from "./NotificationBell";
import ProfileMenu from "./ProfileMenu";
import ShowSearch from "./ShowSearch";

// Site-wide masthead, rendered once from the root layout.
//
// Desktop: wordmark · search · nav, on a three-column grid; the search
// fills the space between the wordmark and a nav whose width varies with
// auth state. Mobile: the search
// column collapses (pages that need search on mobile — the feed — render
// their own full-width ShowSearch) and the nav shrinks to icons.
//
// Signed in, secondary destinations (Profile, Settings, Admin, Sign out)
// live in the avatar menu on every breakpoint; Find Users and the bell
// stay visible on desktop.

// Routes that already put Write Review front and centre, so the header
// doesn't offer the same action twice.
const HIDE_WRITE_REVIEW = new Set(["/", "/review/new"]);

// Routes where the header search would compete with the page's own task.
const HIDE_SEARCH = new Set([
  "/signin",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/confirm-delete",
]);

export default function Masthead() {
  const authUser = useAuthUser();
  const pathname = usePathname() ?? "/";
  const showWriteReview = !HIDE_WRITE_REVIEW.has(pathname);
  const showSearch = !HIDE_SEARCH.has(pathname);

  return (
    <header className="masthead">
      <div className="container masthead-inner">
        <Link
          href="/"
          style={{
            justifySelf: "start",
            fontSize: "22px",
            fontWeight: 700,
            letterSpacing: "-0.04em",
            color: "var(--ink)",
            textDecoration: "none",
          }}
        >
          Afterset
        </Link>

        <div className="masthead-search">
          {showSearch && <ShowSearch variant="header" />}
        </div>

        <nav className="masthead-nav" aria-label="Primary">
          {showWriteReview && (
            <Link
              href="/review/new"
              className="btn btn-secondary btn-sm hide-mobile"
              style={{ marginRight: "6px" }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Write Review
            </Link>
          )}
          {authUser ? (
            <>
              <Link href="/people" className="masthead-link hide-mobile">
                Find Users
              </Link>
              <NotificationBell />
              <ProfileMenu
                handle={authUser.handle}
                isAdmin={!!authUser.isAdmin}
              />
            </>
          ) : (
            <>
              <Link href="/signin" className="masthead-link">
                Sign in
              </Link>
              <Link
                href="/signup"
                className="btn btn-primary btn-sm"
                style={{ marginLeft: "4px" }}
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
