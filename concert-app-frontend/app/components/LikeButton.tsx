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
  /**
   * "default" keeps the original pink heart (show/artist/profile pages).
   * "editorial" renders a restrained monochrome outline heart that fills
   * cream when liked — used by the redesigned feed ReviewCard.
   */
  variant?: "default" | "editorial";
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
  variant = "default",
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

  if (variant === "editorial") {
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
          gap: "7px",
          fontSize: "13px",
          color: liked ? "#e8e2d4" : "#6f6f6f",
          fontFamily: "inherit",
          lineHeight: 1,
        }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill={liked ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ display: "block" }}
        >
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
        <span>{count}</span>
      </button>
    );
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
