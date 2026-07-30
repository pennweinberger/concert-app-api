"use client";

/**
 * Ambient colour wash behind the editorial feed.
 *
 * Column-anchored, not viewport-anchored: each glow is positioned relative
 * to the centred 700px reading column, so it keeps framing the content at
 * any window size. Anchored to the viewport corners instead, the glows drift
 * hundreds of pixels away from the column on a wide display and read as
 * unrelated background wash. On a phone the column is ~the whole width, so
 * the two behave identically there.
 *
 * `position: fixed` so it stays put while the feed scrolls — an absolute
 * layer would stretch its gradients over the full document height and go
 * flat on a long page. The layer covers the whole viewport and every
 * gradient fades to transparent within it, so it adds no scrollable area.
 */

// Half of the 700px reading column, used to place each glow relative to
// the column's edge rather than the window's.
const HALF_COL = 350;

/**
 * Each glow is centred with `calc(50% ± n)`, so its core sits a fixed
 * distance outside the centred column at every window width — that is what
 * "column-anchored" means here. Radii are absolute for the same reason:
 * percentage radii would resolve against the viewport and so would swell on
 * a wide monitor.
 *
 * Two constraints are in tension and both matter:
 *  - Cores must stay OUTSIDE the column, or the bright centre lands behind
 *    the feed and hazes the text.
 *  - The layer must span the FULL viewport. Capping its width to the column
 *    (an earlier attempt) put a hard boundary in the middle of the page
 *    while the gradient was still bright there, so the colour ended in a
 *    visible vertical seam on a wide screen.
 */
function glow(
  dx: number,
  y: string,
  rx: number,
  ry: number,
  colour: string,
): string {
  const x = dx >= 0 ? `calc(50% + ${dx}px)` : `calc(50% - ${Math.abs(dx)}px)`;
  return `radial-gradient(${rx}px ${ry}px at ${x} ${y}, ${colour}, transparent 70%)`;
}

// Offsets stay close to the column edge and radii are generous: pushed
// further out with tighter radii, the glows stop reading as a halo around
// the column and become three discrete blobs floating in the empty margins
// of a wide monitor. Keeping them large, soft and near the column means the
// visible part is falloff hugging the cards, with the cores still outside
// the text.
const GLOWS = [
  // purple, upper right of the column
  glow(HALF_COL + 130, "36%", 660, 570, "rgba(176,44,232,.42)"),
  // ember, left of the column, lower down
  glow(-(HALF_COL + 110), "72%", 620, 530, "rgba(240,92,34,.34)"),
  // magenta, bottom right
  glow(HALF_COL + 90, "90%", 520, 440, "rgba(232,66,148,.26)"),
].join(", ");

export default function PageGlow() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        background: GLOWS,
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
}
