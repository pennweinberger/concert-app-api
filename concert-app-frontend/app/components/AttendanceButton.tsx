"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "../lib/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type Props = {
  showId: string;
  initialAttended: boolean;
  initialAttendanceCount: number;
  /** True when the current viewer has already reviewed this show. In that
   *  case the button is disabled and labeled — a review always implies
   *  attendance, and unattending is blocked server-side (409). */
  blockedByReview?: boolean;
  /** Called after a successful toggle so the parent can keep header
   *  counts in sync without a full refetch. */
  onChange?: (next: { attended: boolean; attendanceCount: number }) => void;
};

/**
 * Mark-as-Attended toggle. Same pattern as LikeButton / FollowButton:
 * optimistic toggle with rollback, single-flight, signed-out clicks
 * redirect to /signin preserving the current URL.
 *
 * Two visual states (cream foundation, no other accent):
 *   Not attended -> cream outline on transparent ("Mark as Attended")
 *   Attended     -> cream fill on off-black text ("Attended")
 */
export default function AttendanceButton({
  showId,
  initialAttended,
  initialAttendanceCount,
  blockedByReview = false,
  onChange,
}: Props) {
  const router = useRouter();
  const [attended, setAttended] = useState(initialAttended);
  const [count, setCount] = useState(initialAttendanceCount);
  const [errorFlash, setErrorFlash] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function toggle() {
    if (inFlight.current) return;
    if (blockedByReview) {
      setErrorFlash(
        "You've reviewed this show. Delete the review to unattend.",
      );
      window.setTimeout(() => setErrorFlash(null), 3000);
      return;
    }

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
    const prevAttended = attended;
    const prevCount = count;

    const nextAttended = !prevAttended;
    setAttended(nextAttended);
    setCount(prevCount + (nextAttended ? 1 : -1));

    try {
      const res = await fetch(`${API_BASE}/shows/${showId}/attend`, {
        method: nextAttended ? "POST" : "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        // Roll back
        setAttended(prevAttended);
        setCount(prevCount);
        if (res.status === 401) {
          const next =
            typeof window !== "undefined"
              ? window.location.pathname + window.location.search
              : "/";
          router.push(`/signin?next=${encodeURIComponent(next)}`);
        } else if (res.status === 409) {
          // Server says you can't unattend because you've reviewed.
          const data = await res.json().catch(() => ({}));
          setErrorFlash(data?.error || "Can't unattend a reviewed show.");
          window.setTimeout(() => setErrorFlash(null), 3000);
        }
        return;
      }

      const data = await res.json().catch(() => null);
      if (data && typeof data.attendanceCount === "number") {
        setCount(data.attendanceCount);
      }
      if (data && typeof data.attended === "boolean") {
        setAttended(data.attended);
      }
      onChange?.({
        attended: data?.attended ?? nextAttended,
        attendanceCount:
          data?.attendanceCount ?? prevCount + (nextAttended ? 1 : -1),
      });
    } catch {
      setAttended(prevAttended);
      setCount(prevCount);
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <div>
      <button
        onClick={toggle}
        aria-pressed={attended}
        disabled={blockedByReview && attended}
        title={
          blockedByReview && attended
            ? "Review implies attendance. Delete the review to unattend."
            : undefined
        }
        style={{
          display: "block",
          width: "100%",
          padding: "12px",
          borderRadius: "12px",
          border: attended
            ? "1px solid transparent"
            : "1px solid #f4f1ea",
          background: attended ? "#f4f1ea" : "transparent",
          color: attended ? "#0a0a0a" : "#f4f1ea",
          cursor:
            blockedByReview && attended ? "not-allowed" : "pointer",
          fontSize: "14px",
          fontWeight: "bold",
          fontFamily: "inherit",
          opacity: blockedByReview && attended ? 0.65 : 1,
          boxSizing: "border-box",
        }}
      >
        {attended ? "Attended" : "Mark as Attended"}
      </button>
      {errorFlash && (
        <div
          style={{
            color: "#ff8080",
            fontSize: "12px",
            marginTop: "6px",
            textAlign: "center",
          }}
        >
          {errorFlash}
        </div>
      )}
    </div>
  );
}
