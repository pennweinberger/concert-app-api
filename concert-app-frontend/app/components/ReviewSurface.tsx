"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * The card shell every review-ish entry sits on: tint, border, fill, radius
 * and padding, in one place.
 *
 * Deliberately a wrapper rather than a prop on `ReviewItem`, so `ReviewItem`
 * / `AttendedItem` / `ReviewCard` stay content-only and the visual system can
 * change without touching any of them.
 *
 * Tint policy differs per surface, and the difference is meaningful:
 *  - Rotating (`tintIndex`) where consecutive entries are DIFFERENT events —
 *    the feed, the artist page, a profile's history. Rotation reads as
 *    variety because there genuinely is variety.
 *  - Uniform (no `tintIndex`) where every entry describes the SAME event —
 *    the show page. Rotating there would imply variety that isn't present.
 *  - `variant="quiet"` for entries that must stay secondary: a profile's
 *    attended-but-not-reviewed shows. Border only, no fill, so reviews stay
 *    visibly louder than bare attendance.
 *
 * Rotation is driven by list position, not a hash of the id: a hash can hand
 * two neighbours the same tint, and position is stable across pagination so
 * appending never recolours a card already on screen.
 */

export type ReviewSurfaceVariant = "tinted" | "quiet";

const SUNSET = [
  {
    border: "rgba(228,150,110,0.42)",
    fill: "linear-gradient(160deg, rgba(70,30,45,0.42), rgba(20,14,24,0.30))",
  },
  {
    border: "rgba(224,110,180,0.40)",
    fill: "linear-gradient(160deg, rgba(58,26,58,0.42), rgba(18,13,22,0.30))",
  },
  {
    border: "rgba(232,150,90,0.40)",
    fill: "linear-gradient(160deg, rgba(74,38,32,0.42), rgba(20,14,18,0.30))",
  },
] as const;

// Same family as the rotation, held back a little: it repeats down the whole
// show page, where three alternating tints would be busy.
const SUNSET_UNIFORM = {
  border: "rgba(226,142,112,0.34)",
  fill: "linear-gradient(160deg, rgba(58,28,38,0.34), rgba(18,13,20,0.26))",
} as const;

const QUIET = {
  border: "#232323",
  fill: "none",
} as const;

export default function ReviewSurface({
  variant = "tinted",
  tintIndex,
  as: Tag = "div",
  id,
  style,
  children,
}: {
  /** "tinted" = filled sunset card. "quiet" = outline only, no fill. */
  variant?: ReviewSurfaceVariant;
  /** List position. Provide to rotate the palette; omit for the uniform tint. */
  tintIndex?: number;
  /**
   * Element to render. Defaults to a plain div, because `ReviewItem` and
   * `AttendedItem` already render their own `<article>` carrying the
   * deep-link id. Pass "article" only where the surface itself is the
   * article (the feed's `ReviewCard`) — never set `id` on both, or the
   * document ends up with duplicate ids.
   */
  as?: "div" | "article";
  id?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const tint =
    variant === "quiet"
      ? QUIET
      : typeof tintIndex === "number"
        ? (SUNSET[((tintIndex % SUNSET.length) + SUNSET.length) % SUNSET.length] ??
          SUNSET[0])
        : SUNSET_UNIFORM;

  return (
    <Tag
      id={id}
      style={{
        position: "relative",
        scrollMarginTop: "24px",
        borderRadius: "14px",
        padding: "17px 17px 15px",
        border: `1px solid ${tint.border}`,
        background: tint.fill,
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}
