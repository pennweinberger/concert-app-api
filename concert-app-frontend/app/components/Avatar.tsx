"use client";

/**
 * Round user avatar: a colored circle with the first letter of the display
 * name, falling back to the handle. The color is deterministic per-handle,
 * so the same user always gets the same circle.
 *
 * There is deliberately no image branch and no `avatarUrl` prop. This used
 * to render any URL a user had saved, which meant every viewer's browser
 * fetched it and handed that host their IP, User-Agent and Referer. Dropping
 * the prop rather than ignoring it keeps the guarantee compile-time: adding
 * remote images back has to be a deliberate change here, not something a
 * call site can reintroduce by passing a field through.
 *
 * First-party uploads are planned after launch. Those URLs will be ours, and
 * this is where they will be reintroduced.
 */
type Props = {
  handle: string;
  name?: string | null;
  size?: number;
};

const PALETTE = [
  "#ff4d6d",
  "#fb923c",
  "#fbbf24",
  "#4ade80",
  "#22d3ee",
  "#7dafff",
  "#a78bfa",
  "#f472b6",
];

function colorFor(handle: string): string {
  let hash = 0;
  for (let i = 0; i < handle.length; i++) {
    hash = (hash * 31 + handle.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length] ?? "#7dafff";
}

export default function Avatar({ handle, name, size = 36 }: Props) {
  const label = name?.trim() || `@${handle}`;

  const seed = (name?.trim() || handle).trim();
  const initial = seed.charAt(0).toUpperCase() || "?";
  const bg = colorFor(handle);

  return (
    <div
      aria-label={label}
      role="img"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: bg,
        color: "white",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: "bold",
        fontSize: Math.round(size * 0.45),
        lineHeight: 1,
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {initial}
    </div>
  );
}
