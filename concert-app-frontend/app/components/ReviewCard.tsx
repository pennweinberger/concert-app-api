"use client";

import Link from "next/link";
import StarRating from "./StarRating";
import LikeButton from "./LikeButton";
import ReportMenu from "./ReportMenu";
import { isDeletedHandle, DELETED_USER_LABEL } from "../lib/displayUser";
import { formatShowDate } from "../lib/dateFormat";

// Editorial review card for the feed. Hierarchy (per product philosophy):
// show title → rating → review prose (the hero) → venue·date → byline →
// subdued likes/comments. Reviews read as short editorial pieces, not
// social posts. Reusable so it can later replace the inline review
// rendering on show / artist / profile pages.

export type ReviewCardShow = {
  id: string;
  localDate: string;
  artist: string;
  venue: string;
  city: string;
};

export type ReviewCardData = {
  reviewId: string;
  userHandle: string;
  userName: string | null;
  ratingOverall: number;
  reviewTextRaw: string;
  likeCount: number;
  commentCount: number;
  liked: boolean;
  show: ReviewCardShow;
};

// Monochrome palette tokens (kept local to the editorial surface).
const CREAM = "#f4f1ea";
const MUTED = "#8a8a8a";
const SUBDUED = "#6a6a6a";

export default function ReviewCard({
  item,
  viewerHandle,
}: {
  item: ReviewCardData;
  /** The signed-in user's handle, or null. Used to hide self-report. */
  viewerHandle: string | null;
}) {
  const deleted = isDeletedHandle(item.userHandle);
  const hasBody = item.reviewTextRaw.trim().length > 0;

  return (
    <article
      id={`review-${item.reviewId}`}
      style={{ position: "relative", scrollMarginTop: "24px" }}
    >
      {/* Whole-card overlay link to the show — preserves click-anywhere
          navigation. Interactive children re-enable pointer events. */}
      <Link
        href={`/show/${item.show.id}`}
        aria-label={`View show: ${item.show.artist} at ${item.show.venue}`}
        style={{ position: "absolute", inset: 0, zIndex: 0 }}
      />

      <div style={{ position: "relative", zIndex: 1, pointerEvents: "none" }}>
        {/* 1 — Show title (headline) */}
        <h2
          style={{
            margin: 0,
            fontSize: "27px",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            lineHeight: 1.12,
            color: CREAM,
          }}
        >
          {item.show.artist}
        </h2>

        {/* 2 — Rating (quiet, monochrome, supports the review) */}
        <div style={{ marginTop: "11px" }}>
          <StarRating
            rating={item.ratingOverall}
            size={14}
            filledColor={CREAM}
            emptyColor="#333"
          />
        </div>

        {/* 3 — Review prose (the hero; constrained measure for reading) */}
        {hasBody && (
          <p
            style={{
              margin: "16px 0 0",
              fontSize: "19px",
              lineHeight: 1.62,
              maxWidth: "640px",
              color: CREAM,
            }}
          >
            {item.reviewTextRaw}
          </p>
        )}

        {/* 4 — Venue · date. When there is no review body the prose block
            is not rendered at all, so we pull the metadata up close to the
            rating instead of leaving the body's gap behind. */}
        <div
          style={{
            fontSize: "14px",
            color: MUTED,
            marginTop: hasBody ? "16px" : "10px",
          }}
        >
          {item.show.venue}
          <span style={{ margin: "0 7px" }}>•</span>
          {formatShowDate(item.show.localDate)}
        </div>

        {/* 5 — Byline (reviewer as critic) */}
        <div style={{ fontSize: "14px", color: MUTED, marginTop: "5px" }}>
          <span aria-hidden="true">— </span>
          {deleted ? (
            <span>{DELETED_USER_LABEL}</span>
          ) : (
            <Link
              href={`/user/${item.userHandle}`}
              style={{
                color: "#d8d1c2",
                textDecoration: "none",
                pointerEvents: "auto",
                position: "relative",
              }}
            >
              @{item.userHandle}
            </Link>
          )}
        </div>

        {/* 6 — Likes / comments (subdued, still clearly interactive) */}
        <div
          style={{
            marginTop: "14px",
            display: "flex",
            alignItems: "center",
            gap: "18px",
            pointerEvents: "auto",
            position: "relative",
          }}
        >
          <LikeButton
            reviewId={item.reviewId}
            initialLiked={item.liked}
            initialLikeCount={item.likeCount}
            variant="editorial"
          />
          <Link
            href={`/show/${item.show.id}`}
            aria-label={`${item.commentCount} comments`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "7px",
              color: SUBDUED,
              fontSize: "13px",
              textDecoration: "none",
              pointerEvents: "auto",
              position: "relative",
            }}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ display: "block" }}
            >
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
            <span>{item.commentCount}</span>
          </Link>
          {viewerHandle && viewerHandle !== item.userHandle && (
            <span style={{ marginLeft: "auto" }}>
              <ReportMenu targetType="REVIEW" targetId={item.reviewId} />
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
