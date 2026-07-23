"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken, authHeaders } from "../lib/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

/**
 * Header notification bell. Shows an unread badge and links to
 * /notifications. Fetches the unread count once on mount (no polling /
 * websockets per v1 scope). The count endpoint is cheap + indexed.
 */
export default function NotificationBell() {
  const router = useRouter();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/notifications/unread-count`, {
          headers: authHeaders(),
        });
        if (cancelled || !res.ok) return;
        const data = await res.json();
        if (!cancelled && typeof data.count === "number") setCount(data.count);
      } catch {
        // Silent — the bell is non-critical chrome.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <button
      onClick={() => router.push("/notifications")}
      aria-label={
        count > 0 ? `Notifications, ${count} unread` : "Notifications"
      }
      style={{
        position: "relative",
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        color: "#9a9a9a",
        lineHeight: 1,
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ display: "block" }}
      >
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {count > 0 && (
        <span
          style={{
            position: "absolute",
            top: "-6px",
            right: "-8px",
            background: "#f4f1ea",
            color: "#0a0a0a",
            borderRadius: "999px",
            fontSize: "10px",
            fontWeight: 700,
            minWidth: "16px",
            height: "16px",
            padding: "0 4px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
          }}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
