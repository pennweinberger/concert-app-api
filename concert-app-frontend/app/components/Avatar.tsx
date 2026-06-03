"use client";

/**
 * Round user avatar. Renders the image at `avatarUrl` when provided;
 * otherwise generates a colored circle with the first letter of the
 * display name (falling back to the handle). The color is deterministic
 * per-handle so the same user always gets the same circle.
 */
type Props = {
  handle: string;
  name?: string | null;
  avatarUrl?: string | null;
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

export default function Avatar({
  handle,
  name,
  avatarUrl,
  size = 36,
}: Props) {
  const label = name?.trim() || `@${handle}`;

  if (avatarUrl) {
    // Plain <img>: lets users paste any URL (Gravatar, S3, social pic,
    // etc.) without us provisioning storage. Using next/image would
    // require allowlisting every conceivable host in next.config.
    /* eslint-disable @next/next/no-img-element */
    return (
      <img
        src={avatarUrl}
        alt={label}
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          background: "#222",
          flexShrink: 0,
        }}
      />
    );
    /* eslint-enable @next/next/no-img-element */
  }

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
