"use client";

import Link from "next/link";
import StarRating from "./StarRating";
import LikeButton from "./LikeButton";
import ReportMenu from "./ReportMenu";
import Avatar from "./Avatar";
import ReviewSurface from "./ReviewSurface";
import { isDeletedHandle, DELETED_USER_LABEL } from "../lib/displayUser";
import { formatShowDate } from "../lib/dateFormat";

// Editorial review card for the feed. Hierarchy (per product philosophy):
// artist name → rating → review prose (the hero) → venue·date → byline →
// subdued likes/comments. Reviews read as short editorial pieces, not
// social posts. Reusable so it can later replace the inline review
// rendering on show / artist / profile pages.
//
// Headings stay on Inter: a display serif (Libre Caslon Display) was tried
// here and reverted — the card's own border and fill already carry the
// editorial signal, and the serif read as a different product.

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

const CREAM = "#f4f1ea";
const MUTED = "#8a8a8a";
const SUBDUED = "#6a6a6a";

export default function ReviewCard({
  item,
  viewerHandle,
  tintIndex = 0,
}: {
  item: ReviewCardData;
  /** The signed-in user's handle, or null. Used to hide self-report. */
  viewerHandle: string | null;
  /** Feed position, used to pick the card's border/fill tint. */
  tintIndex?: number;
}) {
  const deleted = isDeletedHandle(item.userHandle);
  const hasBody = item.reviewTextRaw.trim().length > 0;

  return (
    <ReviewSurface as="article" id={`review-${item.reviewId}`} tintIndex={tintIndex}>
      {/* Whole-card overlay link to the show — preserves click-anywhere
          navigation. Interactive children re-enable pointer events. */}
      <Link
        href={`/show/${item.show.id}`}
        aria-label={`View show: ${item.show.artist} at ${item.show.venue}`}
        style={{ position: "absolute", inset: 0, zIndex: 0, borderRadius: "14px" }}
      />

      <div style={{ position: "relative", zIndex: 1, pointerEvents: "none" }}>
        {/* 1 — Artist (headline) */}
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
              margin: "11px 0 0",
              // Was 19px when reviews sat directly on the page background
              // and needed the size to carry presence. Inside a bordered
              // card the measure is ~34px narrower and the card itself
              // provides the emphasis, so 19px broke to very short lines
              // on a phone. 16.5px is the size approved in the mockup.
              fontSize: "16.5px",
              lineHeight: 1.58,
              maxWidth: "640px",
              color: "#e2ded4",
            }}
          >
            {item.reviewTextRaw}
          </p>
        )}

        {/* Hairline: separates the review itself from its attribution. */}
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.09)",
            margin: hasBody ? "13px 0 11px" : "11px 0",
          }}
        />

        {/* 4 — Venue · date */}
        <div
          style={{
            fontSize: "13.5px",
            color: MUTED,
            display: "flex",
            alignItems: "center",
            gap: "7px",
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            aria-hidden="true"
            style={{ flex: "0 0 auto" }}
          >
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
            <circle cx="12" cy="10" r="2.6" />
          </svg>
          <span>
            {item.show.venue}
            <span style={{ margin: "0 7px", opacity: 0.5 }}>•</span>
            {formatShowDate(item.show.localDate)}
          </span>
        </div>

        {/* 5 — Byline (reviewer as critic) */}
        <div
          style={{
            fontSize: "13.5px",
            color: "#b9b3a6",
            marginTop: "9px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          {deleted ? (
            <span>{DELETED_USER_LABEL}</span>
          ) : (
            <Link
              href={`/user/${item.userHandle}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                color: "#b9b3a6",
                textDecoration: "none",
                pointerEvents: "auto",
                position: "relative",
              }}
            >
              <Avatar
                handle={item.userHandle}
                name={item.userName}
                size={25}
              />
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
    </ReviewSurface>
  );
}
