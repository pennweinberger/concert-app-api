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
// A display serif (Libre Caslon Display) was tried for the artist name and
// reverted — it read as a different product. Headlines use the body family
// at a heavy weight with tight tracking instead.

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

const PIN_ICON = (
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
);

const COMMENT_ICON = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ display: "block" }}
  >
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

/**
 * A review in the feed. Content order is fixed: artist, rating, prose,
 * venue · date, byline, then likes / comments.
 *
 * `featured` is the wide treatment the feed gives its newest review: the
 * artist and rating take a headline column and the prose is set large
 * beside them. The order is unchanged; only the composition differs.
 */
export default function ReviewCard({
  item,
  viewerHandle,
  featured = false,
}: {
  item: ReviewCardData;
  /** The signed-in user's handle, or null. Used to hide self-report. */
  viewerHandle: string | null;
  featured?: boolean;
}) {
  const deleted = isDeletedHandle(item.userHandle);
  const hasBody = item.reviewTextRaw.trim().length > 0;

  const artist = (
    <h2
      style={{
        margin: 0,
        fontSize: featured ? "clamp(32px, 4vw, 52px)" : "clamp(26px, 2.6vw, 30px)",
        fontWeight: 700,
        letterSpacing: featured ? "-0.045em" : "-0.035em",
        lineHeight: 1.02,
      }}
    >
      {item.show.artist}
    </h2>
  );

  const rating = (
    <div style={{ marginTop: featured ? "16px" : "12px" }}>
      <StarRating rating={item.ratingOverall} size={featured ? 20 : 16} />
    </div>
  );

  const prose = hasBody && (
    <p
      style={{
        margin: featured ? 0 : "14px 0 0",
        fontSize: featured ? "clamp(20px, 2.2vw, 30px)" : "17px",
        lineHeight: featured ? 1.3 : 1.5,
        fontWeight: featured ? 500 : 400,
        letterSpacing: featured ? "-0.025em" : "-0.01em",
        overflowWrap: "anywhere",
      }}
    >
      {item.reviewTextRaw}
    </p>
  );

  const venue = (
    <span
      className="meta"
      style={{ display: "inline-flex", alignItems: "center", gap: "7px" }}
    >
      {PIN_ICON}
      <span>
        {item.show.venue} · {formatShowDate(item.show.localDate)}
      </span>
    </span>
  );

  const byline = deleted ? (
    <span className="meta">{DELETED_USER_LABEL}</span>
  ) : (
    <Link
      href={`/user/${item.userHandle}`}
      className="link-quiet"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        fontSize: "13.5px",
        fontWeight: 600,
        pointerEvents: "auto",
        position: "relative",
      }}
    >
      <Avatar handle={item.userHandle} name={item.userName} size={26} />@
      {item.userHandle}
    </Link>
  );

  const actions = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "16px",
        pointerEvents: "auto",
        position: "relative",
      }}
    >
      <LikeButton
        reviewId={item.reviewId}
        initialLiked={item.liked}
        initialLikeCount={item.likeCount}
      />
      <Link
        href={`/show/${item.show.id}`}
        aria-label={`${item.commentCount} comments`}
        className="text-action"
      >
        {COMMENT_ICON}
        <span>{item.commentCount}</span>
      </Link>
      {viewerHandle && viewerHandle !== item.userHandle && (
        <ReportMenu targetType="REVIEW" targetId={item.reviewId} />
      )}
    </div>
  );

  return (
    <ReviewSurface
      as="article"
      id={`review-${item.reviewId}`}
      className={`card-link${featured ? " card-lg" : ""}`}
      style={{ display: "flex", flexDirection: "column" }}
    >
      {/* Whole-card overlay link to the show — preserves click-anywhere
          navigation. Interactive children re-enable pointer events. */}
      <Link
        href={`/show/${item.show.id}`}
        aria-label={`View show: ${item.show.artist} at ${item.show.venue}`}
        style={{ position: "absolute", inset: 0, zIndex: 0, borderRadius: "inherit" }}
      />

      {featured ? (
        <div
          className="split-5-7"
          style={{ position: "relative", zIndex: 1, pointerEvents: "none" }}
        >
          <div>
            <div className="eyebrow" style={{ color: "var(--accent-ink)", marginBottom: "12px" }}>
              Newest
            </div>
            {artist}
            {rating}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              gap: "28px",
            }}
          >
            {prose || <span />}
            <div
              style={{
                borderTop: "1px solid var(--line-soft)",
                paddingTop: "16px",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px 20px",
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 20px" }}>
                {venue}
                {byline}
              </div>
              {actions}
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            position: "relative",
            zIndex: 1,
            pointerEvents: "none",
            display: "flex",
            flexDirection: "column",
            flex: 1,
          }}
        >
          {artist}
          {rating}
          {prose}
          <div
            style={{
              marginTop: "auto",
              paddingTop: "22px",
            }}
          >
            <div
              style={{
                borderTop: "1px solid var(--line-soft)",
                paddingTop: "14px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              {venue}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                }}
              >
                {byline}
                {actions}
              </div>
            </div>
          </div>
        </div>
      )}
    </ReviewSurface>
  );
}
