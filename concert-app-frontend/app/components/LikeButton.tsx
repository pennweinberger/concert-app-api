"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "../lib/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type Props = {
  reviewId: string;
  initialLiked: boolean;
  initialLikeCount: number;
};

/**
 * Heart-icon like button with optimistic toggle.
 *
 * - Signed-out clicks redirect to /signin?next=<current path>.
 * - Optimistically toggles state on click; rolls back on API error.
 * - Single-flight: rapid double-clicks are ignored while a request is in
 *   flight (the visible state already reflects the optimistic toggle).
 * - Syncs to authoritative server count from the API response so cross-
 *   client drift gets corrected.
 */
export default function LikeButton({
  reviewId,
  initialLiked,
  initialLikeCount,
}: Props) {
  const router = useRouter();
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialLikeCount);
  const inFlight = useRef(false);

  async function toggle() {
    if (inFlight.current) return;

    const token = getToken();
    if (!token) {
      const next =
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : "/";
      router.push(`/signin?next=${encodeURIComponent(next)}`);
      return;
    }

    inFlight.current = true;

    // Capture current state for potential rollback
    const prevLiked = liked;
    const prevCount = count;

    // Optimistic update
    const nextLiked = !prevLiked;
    setLiked(nextLiked);
    setCount(prevCount + (nextLiked ? 1 : -1));

    try {
      const res = await fetch(`${API_BASE}/reviews/${reviewId}/like`, {
        method: nextLiked ? "POST" : "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        // Roll back
        setLiked(prevLiked);
        setCount(prevCount);
        if (res.status === 401) {
          const next =
            typeof window !== "undefined"
              ? window.location.pathname + window.location.search
              : "/";
          router.push(`/signin?next=${encodeURIComponent(next)}`);
        }
        return;
      }

      // Sync to server's authoritative state
      const data = await res.json().catch(() => null);
      if (data && typeof data.likeCount === "number") {
        setCount(data.likeCount);
      }
      if (data && typeof data.liked === "boolean") {
        setLiked(data.liked);
      }
    } catch {
      setLiked(prevLiked);
      setCount(prevCount);
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label={liked ? "Unlike" : "Like"}
      aria-pressed={liked}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "14px",
        color: liked ? "#ff4d6d" : "#888",
        fontFamily: "inherit",
        lineHeight: 1,
      }}
    >
      <span style={{ fontSize: "17px" }}>{liked ? "♥" : "♡"}</span>
      <span>{count}</span>
    </button>
  );
}
