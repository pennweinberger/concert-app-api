"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "../lib/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type Props = {
  handle: string;
  initialFollowing: boolean;
  initialFollowerCount: number;
  /** Called after a successful toggle so the parent can keep header
   *  counts in sync without a full refetch. Receives the new state. */
  onChange?: (next: { following: boolean; followerCount: number }) => void;
};

/**
 * Follow / Unfollow toggle, modeled after LikeButton:
 *  - Optimistic toggle with rollback on API error.
 *  - Single-flight (rapid double-clicks ignored while a request is in flight).
 *  - Signed-out clicks redirect to /signin with next= preserved.
 */
export default function FollowButton({
  handle,
  initialFollowing,
  initialFollowerCount,
  onChange,
}: Props) {
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [count, setCount] = useState(initialFollowerCount);
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
    const prevFollowing = following;
    const prevCount = count;

    const nextFollowing = !prevFollowing;
    setFollowing(nextFollowing);
    setCount(prevCount + (nextFollowing ? 1 : -1));

    try {
      const res = await fetch(`${API_BASE}/users/${handle}/follow`, {
        method: nextFollowing ? "POST" : "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        setFollowing(prevFollowing);
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

      const data = await res.json().catch(() => null);
      if (data && typeof data.followerCount === "number") {
        setCount(data.followerCount);
      }
      if (data && typeof data.following === "boolean") {
        setFollowing(data.following);
      }
      onChange?.({
        following: data?.following ?? nextFollowing,
        followerCount: data?.followerCount ?? prevCount + (nextFollowing ? 1 : -1),
      });
    } catch {
      setFollowing(prevFollowing);
      setCount(prevCount);
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <button
      onClick={toggle}
      aria-pressed={following}
      style={{
        padding: "8px 18px",
        borderRadius: "20px",
        border: following ? "1px solid #444" : "1px solid #2d6cff",
        background: following ? "transparent" : "#2d6cff",
        color: following ? "#aaa" : "white",
        cursor: "pointer",
        fontSize: "13px",
        fontWeight: "bold",
        lineHeight: 1,
        fontFamily: "inherit",
      }}
    >
      {following ? "Following" : "Follow"}
    </button>
  );
}
