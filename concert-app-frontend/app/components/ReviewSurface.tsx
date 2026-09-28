"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * The card shell every review-ish entry sits on: fill, edge, radius and
 * padding, in one place.
 *
 * Deliberately a wrapper rather than a prop on `ReviewItem`, so `ReviewItem`
 * / `AttendedItem` / `ReviewCard` stay content-only and the visual system can
 * change without touching any of them.
 *
 * Lists sit on a grey `.band`, so the default is a white card. Variants:
 *  - "card" (default): white card, the normal home for a review.
 *  - "quiet": outline only, no fill — for entries that must stay secondary,
 *    like a profile's attended-but-not-reviewed shows, so reviews stay
 *    visibly louder than bare attendance.
 */

export type ReviewSurfaceVariant = "card" | "quiet";

export default function ReviewSurface({
  variant = "card",
  as: Tag = "div",
  id,
  className,
  style,
  children,
}: {
  variant?: ReviewSurfaceVariant;
  /**
   * Element to render. Defaults to a plain div, because `ReviewItem` and
   * `AttendedItem` already render their own `<article>` carrying the
   * deep-link id. Pass "article" only where the surface itself is the
   * article (the feed's `ReviewCard`) — never set `id` on both, or the
   * document ends up with duplicate ids.
   */
  as?: "div" | "article";
  id?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const quiet = variant === "quiet";
  return (
    <Tag
      id={id}
      className={`card${className ? ` ${className}` : ""}`}
      style={{
        position: "relative",
        scrollMarginTop: "88px",
        ...(quiet
          ? {
              background: "transparent",
              boxShadow: "none",
              border: "1px solid var(--line)",
            }
          : null),
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}
