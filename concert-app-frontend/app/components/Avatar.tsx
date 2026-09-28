"use client";

/**
 * Round user avatar: an ink circle with the first letter of the display
 * name, falling back to the handle. Deliberately monochrome — the site's
 * only saturated colour is the magenta accent, so avatars don't compete.
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

export default function Avatar({ handle, name, size = 36 }: Props) {
  const label = name?.trim() || `@${handle}`;

  const seed = (name?.trim() || handle).trim();
  const initial = seed.charAt(0).toUpperCase() || "?";

  return (
    <div
      aria-label={label}
      role="img"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--ink)",
        color: "white",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 600,
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
