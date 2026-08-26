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

const CREAM = "#f4f1ea";
const MUTED = "#8a8a8a";

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
    <article
      id={`review-${review.id}`}
      style={{ scrollMarginTop: "24px" }}
    >
      {/* 0 — Optional headline (profile: the artist) */}
      {heading}

      {/* 1 — Rating */}
      <div style={{ marginTop: heading ? "11px" : 0 }}>
        <StarRating
          rating={review.ratingOverall}
          size={14}
          filledColor={CREAM}
          emptyColor="#333"
        />
      </div>

      {/* 2 — Review prose (the hero) */}
      {hasBody && (
        <p
          style={{
            margin: "11px 0 0",
            // Matches the feed: these entries now sit inside a
            // ReviewSurface card, which narrows the measure by ~34px and
            // supplies the emphasis 19px used to carry on bare background.
            fontSize: "16.5px",
            lineHeight: 1.58,
            maxWidth: "640px",
            color: "#e2ded4",
          }}
        >
          {review.reviewTextRaw}
        </p>
      )}

      {/* 3 — Performance context (artist page only) */}
      {context && <div style={{ marginTop: hasBody ? "16px" : "14px" }}>{context}</div>}

      {/* 4 — Author byline: display name primary, handle subdued. Not
              rendered where the page already establishes the author. */}
      {!hideByline && (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginTop: context ? "14px" : hasBody ? "16px" : "14px",
        }}
      >
        {deleted ? (
          <>
            <span
              aria-label="deleted user"
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: "#2a2a2a",
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: "14px", color: MUTED }}>
              {DELETED_USER_LABEL}
            </span>
          </>
        ) : (
          <Link
            href={`/user/${review.userHandle}`}
            style={{
              display: "inline-flex",
              alignItems: "baseline",
              gap: "8px",
              textDecoration: "none",
            }}
          >
            <span
              style={{ alignSelf: "center", display: "inline-flex", flexShrink: 0 }}
            >
              <Avatar
                handle={review.userHandle}
                name={review.userName}
                size={20}
              />
            </span>
            {review.userName ? (
              <>
                <span
                  style={{ fontSize: "14px", fontWeight: 600, color: "#d8d1c2" }}
                >
                  {review.userName}
                </span>
                <span style={{ fontSize: "13px", color: "#6f6f6f" }}>
                  @{review.userHandle}
                </span>
              </>
            ) : (
              <span
                style={{ fontSize: "14px", fontWeight: 600, color: "#d8d1c2" }}
              >
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
          marginTop: hideByline ? "14px" : "12px",
          display: "flex",
          alignItems: "flex-start",
          gap: "18px",
        }}
      >
        <LikeButton
          reviewId={review.id}
          initialLiked={review.liked}
          initialLikeCount={review.likeCount}
          variant="editorial"
        />
        {actions}
      </div>

      {children}
    </article>
  );
}
