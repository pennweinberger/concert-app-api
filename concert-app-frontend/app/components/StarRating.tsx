"use client";

/**
 * Read-only 5-star rating display. Filled stars for the given rating,
 * light-grey stars for the remainder. Used on review cards across home,
 * show, artist, and user-profile pages.
 *
 * The interactive star picker on /review/new and the inline edit form
 * are NOT this component — they have their own click handlers and live
 * inline with the form code.
 */
type Props = {
  rating: number;
  size?: number;
};

// Shared with the interactive pickers so every star on the site matches.
export const STAR_PATH =
  "M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z";

export default function StarRating({ rating, size = 15 }: Props) {
  return (
    <div
      role="img"
      aria-label={`${rating} out of 5 stars`}
      style={{ display: "inline-flex", gap: "2px", lineHeight: 0 }}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          aria-hidden="true"
          style={{ display: "block" }}
        >
          <path
            d={STAR_PATH}
            fill={n <= rating ? "var(--ink)" : "var(--disabled)"}
          />
        </svg>
      ))}
    </div>
  );
}
