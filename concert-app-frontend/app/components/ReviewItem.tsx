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
  userAvatarUrl: string | null;
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
  actions,
  children,
}: {
  review: ReviewItemData;
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
      {/* 1 — Rating */}
      <StarRating
        rating={review.ratingOverall}
        size={14}
        filledColor={CREAM}
        emptyColor="#333"
      />

      {/* 2 — Review prose (the hero) */}
      {hasBody && (
        <p
          style={{
            margin: "14px 0 0",
            fontSize: "19px",
            lineHeight: 1.62,
            maxWidth: "640px",
            color: CREAM,
          }}
        >
          {review.reviewTextRaw}
        </p>
      )}

      {/* 3 — Author byline: display name primary, handle subdued */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginTop: hasBody ? "16px" : "14px",
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
                avatarUrl={review.userAvatarUrl}
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

      {/* 4 — Subdued actions */}
      <div
        style={{
          marginTop: "12px",
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
