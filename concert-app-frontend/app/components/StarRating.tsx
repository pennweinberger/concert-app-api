"use client";

/**
 * Read-only 5-star rating display. Filled stars for the given rating,
 * muted stars for the remainder. Used on review cards across home, show,
 * artist, and user-profile pages.
 *
 * The interactive star picker on /review/new and the inline edit form
 * are NOT this component — they have their own click handlers and live
 * inline with the form code.
 */
type Props = {
  rating: number;
  size?: number;
  /** Filled-star color. Defaults to the original gold used on show/
   *  artist/profile pages; the editorial feed passes a monochrome cream. */
  filledColor?: string;
  emptyColor?: string;
};

export default function StarRating({
  rating,
  size = 14,
  filledColor = "#fbbf24",
  emptyColor = "#444",
}: Props) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: "2px",
        fontSize: `${size}px`,
        lineHeight: 1,
      }}
      aria-label={`${rating} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          aria-hidden="true"
          style={{ color: n <= rating ? filledColor : emptyColor }}
        >
          ★
        </span>
      ))}
    </div>
  );
}
