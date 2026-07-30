"use client";

/**
 * Ambient colour wash behind the editorial feed.
 *
 * Column-anchored, not viewport-anchored: the layer is centred and capped
 * at the reading column's width, so the glows keep framing the content at
 * any window size. Anchored to the viewport corners instead, they drift
 * hundreds of pixels away from the 700px column on a wide display and read
 * as unrelated background wash. On a phone the column is ~the whole width,
 * so the two behave identically there.
 *
 * `position: fixed` so it stays put while the feed scrolls — an absolute
 * layer would stretch its gradients over the full document height and go
 * flat on a long page. Gradients are kept inside the layer's own bounds
 * (no negative insets), so this can never introduce horizontal overflow.
 */

// Gradient CENTRES sit at or just outside the layer's edges, so only the
// soft outer falloff reaches the text. Centring them inside the layer
// instead puts the bright core directly behind the feed and hazes it —
// which is exactly what a first pass here did. Because the layer is capped
// to the column's width, "just outside the layer" is also just outside the
// reading column on a wide screen, so the framing still lands.
const GLOWS = [
  // purple, right of the column
  "radial-gradient(58% 42% at 108% 40%, rgba(176,44,232,.44), transparent 66%)",
  // ember, left of the column, lower
  "radial-gradient(52% 36% at -10% 74%, rgba(240,92,34,.36), transparent 68%)",
  // magenta, bottom right
  "radial-gradient(44% 26% at 98% 88%, rgba(232,66,148,.30), transparent 70%)",
].join(", ");

export default function PageGlow() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        top: 0,
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(100%, 760px)",
        height: "100vh",
        background: GLOWS,
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
}
