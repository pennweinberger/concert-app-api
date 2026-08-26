"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Avatar from "../components/Avatar";
import { getToken, authHeaders, useAuthUser } from "../lib/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type NotificationActor = {
  handle: string;
  name: string | null;
};

type NotificationItem = {
  id: string;
  type: string;
  entityId: string | null;
  metadata: { showId?: string; commentId?: string } | null;
  readAt: string | null;
  createdAt: string;
  actor: NotificationActor | null;
};

function actionText(type: string): string {
  switch (type) {
    case "follow":
      return "followed you";
    case "review_like":
      return "liked your review";
    case "review_comment":
      return "commented on your review";
    default:
      return "did something";
  }
}

// follow -> actor profile. review_like / review_comment -> the show page
// where the review renders (there is no standalone /review/:id route);
// showId rides in metadata. Fall back to the actor profile, then home.
function hrefFor(n: NotificationItem): string {
  if (n.type === "follow" && n.actor) {
    return `/user/${n.actor.handle}`;
  }
  if (n.metadata?.showId) {
    return `/show/${n.metadata.showId}`;
  }
  if (n.actor) {
    return `/user/${n.actor.handle}`;
  }
  return "/";
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NotificationsPage() {
  const router = useRouter();
  const authUser = useAuthUser();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Auth gate.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!getToken()) {
      router.replace("/signin?next=/notifications");
    }
  }, [authUser, router]);

  // Load notifications, then mark all read (v1: opening the page clears
  // the unread badge).
  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/notifications`, {
          headers: authHeaders(),
        });
        if (cancelled) return;
        if (!res.ok) {
          setError("Could not load notifications.");
          setLoading(false);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setItems(data.items ?? []);
        setLoading(false);

        // Mark all read on open — fire-and-forget. The list above still
        // shows which were unread (we captured readAt before this call).
        if ((data.unreadCount ?? 0) > 0) {
          fetch(`${API_BASE}/notifications/read-all`, {
            method: "POST",
            headers: authHeaders(),
          }).catch(() => {});
        }
      } catch {
        if (!cancelled) {
          setError("Could not load notifications.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!authUser) {
    return (
      <main
        style={{ background: "#0a0a0a", minHeight: "100vh", color: "#f4f1ea" }}
      />
    );
  }

  return (
    <main
      style={{
        background: "#0a0a0a",
        minHeight: "100vh",
        color: "#f4f1ea",
        padding: "24px",
      }}
    >
      <div style={{ maxWidth: "700px", margin: "0 auto" }}>
        <div style={{ marginBottom: "20px" }}>
          <Link
            href="/"
            style={{
              color: "#f4f1ea",
              textDecoration: "underline",
              textUnderlineOffset: "3px",
            }}
          >
            ← Back to feed
          </Link>
        </div>

        <h1
          style={{
            fontSize: "30px",
            marginBottom: "24px",
            fontFamily: "var(--font-display), sans-serif",
            fontWeight: 700,
            letterSpacing: "-0.02em",
          }}
        >
          Notifications
        </h1>

        {loading && (
          <div style={{ color: "#888", padding: "16px" }}>Loading…</div>
        )}
        {error && !loading && (
          <div style={{ color: "#ff8080", padding: "16px" }}>{error}</div>
        )}
        {!loading && !error && items.length === 0 && (
          <div style={{ color: "#888", padding: "16px" }}>
            No notifications yet.
          </div>
        )}

        {items.map((n) => {
          const unread = !n.readAt;
          return (
            <Link
              key={n.id}
              href={hrefFor(n)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "14px",
                borderRadius: "12px",
                background: unread ? "#171a22" : "#141414",
                border: unread ? "1px solid #2a3550" : "1px solid #222",
                marginBottom: "8px",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <Avatar
                handle={n.actor?.handle ?? "?"}
                name={n.actor?.name ?? null}
                size={40}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>
                  <span style={{ fontWeight: 600 }}>
                    {n.actor ? `@${n.actor.handle}` : "Someone"}
                  </span>{" "}
                  <span style={{ color: "#cfcfcf" }}>{actionText(n.type)}</span>
                </div>
                <div
                  style={{ color: "#777", fontSize: "13px", marginTop: "2px" }}
                >
                  {timeAgo(n.createdAt)}
                </div>
              </div>
              {unread && (
                <span
                  aria-label="unread"
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "999px",
                    background: "#ff4d6d",
                    flexShrink: 0,
                  }}
                />
              )}
            </Link>
          );
        })}
      </div>
    </main>
  );
}
