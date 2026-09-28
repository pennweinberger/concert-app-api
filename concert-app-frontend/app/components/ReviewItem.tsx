"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import StarRating from "./StarRating";
import LikeButton from "./LikeButton";
import Avatar from "./Avatar";
import { isDeletedHandle, DELETED_USER_LABEL } from "../lib/displayUser";

// Editorial review — the review itself is the subject (used where the
// show identity is already established, e.g. the show page). Hierarchy:
// rating -> review prose -> author byline (display name primary, @handle
// subdued) -> subdued actions.
//
// Deliberately decoupled from any page layout so it can later render as
// the primary content of a canonical review page (afterset.fm/review/:id).
// Each instance carries a stable DOM id (`review-{id}`) for deep links.
// Page-specific extras (comment threads, report menus, show metadata)
// are passed via the `actions` and `children` slots rather than baked in.

export type ReviewItemData = {
  id: string;
  userHandle: string;
  userName: string | null;
  ratingOverall: number;
  reviewTextRaw: string;
  likeCount: number;
  commentCount: number;
  liked: boolean;
};

export default function ReviewItem({
  review,
  heading,
  hideByline = false,
  context,
  actions,
  children,
}: {
  review: ReviewItemData;
  /** Optional headline rendered ABOVE the rating (e.g. the artist name on
   *  a profile, where each entry is a different artist). */
  heading?: ReactNode;
  /** Suppress the byline where the page already establishes the author —
   *  a user's own profile. */
  hideByline?: boolean;
  /** Performance context (venue + date) rendered between the prose and
   *  the byline. Used where each review describes a DIFFERENT event —
   *  the artist page. Omitted on the show page, where the header already
   *  establishes the single performance. */
  context?: ReactNode;
  /** Extra controls rendered in the subdued action row after the like
   *  button (e.g. a comments trigger, a report menu). */
  actions?: ReactNode;
  /** Block content rendered under the action row (e.g. an expanded
   *  comment thread). */
  children?: ReactNode;
}) {
  const deleted = isDeletedHandle(review.userHandle);
  const hasBody = review.reviewTextRaw.trim().length > 0;

  return (
    <article id={`review-${review.id}`} style={{ scrollMarginTop: "88px" }}>
      {/* 0 — Optional headline (profile: the artist) */}
      {heading}

      {/* 1 — Rating */}
      <div style={{ marginTop: heading ? "12px" : 0 }}>
        <StarRating rating={review.ratingOverall} size={16} />
      </div>

      {/* 2 — Review prose (the hero) */}
      {hasBody && (
        <p
          style={{
            margin: "14px 0 0",
            fontSize: "18px",
            lineHeight: 1.5,
            letterSpacing: "-0.012em",
            maxWidth: "680px",
            overflowWrap: "anywhere",
          }}
        >
          {review.reviewTextRaw}
        </p>
      )}

      {/* 3 — Performance context (artist page only) */}
      {context && (
        <div style={{ marginTop: hasBody ? "18px" : "14px" }}>{context}</div>
      )}

      {/* 4 — Author byline: display name primary, handle subdued. Not
              rendered where the page already establishes the author. */}
      {!hideByline && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginTop: context ? "12px" : hasBody ? "18px" : "14px",
          }}
        >
          {deleted ? (
            <>
              <span
                aria-label="deleted user"
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: "var(--surface-2)",
                  flexShrink: 0,
                }}
              />
              <span className="meta">{DELETED_USER_LABEL}</span>
            </>
          ) : (
            <Link
              href={`/user/${review.userHandle}`}
              className="link-quiet"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <Avatar
                handle={review.userHandle}
                name={review.userName}
                size={26}
              />
              {review.userName ? (
                <>
                  <span style={{ fontSize: "14px", fontWeight: 600 }}>
                    {review.userName}
                  </span>
                  <span className="meta">@{review.userHandle}</span>
                </>
              ) : (
                <span style={{ fontSize: "14px", fontWeight: 600 }}>
                  @{review.userHandle}
                </span>
              )}
            </Link>
          )}
        </div>
      )}

      {/* 5 — Subdued actions */}
      <div
        style={{
          marginTop: hideByline ? "14px" : "10px",
          display: "flex",
          alignItems: "flex-start",
          gap: "18px",
        }}
      >
        <LikeButton
          reviewId={review.id}
          initialLiked={review.liked}
          initialLikeCount={review.likeCount}
        />
        {actions}
      </div>

      {children}
    </article>
  );
}
