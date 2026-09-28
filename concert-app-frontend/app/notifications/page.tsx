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
    return <main className="page" />;
  }

  return (
    <main className="page">
      <div
        className="container-sm"
        style={{ paddingTop: "20px", paddingBottom: "clamp(28px, 4vw, 40px)" }}
      >
        <Link
          href="/"
          className="link"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "2px",
            minHeight: "40px",
            fontSize: "15px",
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Back to feed
        </Link>

        <h1 className="h1" style={{ marginTop: "16px" }}>
          Notifications
        </h1>
      </div>

      <section className="band">
        <div
          className="container-sm"
          style={{
            paddingTop: "clamp(28px, 4vw, 48px)",
            paddingBottom: "clamp(40px, 6vw, 80px)",
          }}
        >
          {loading && (
            <div className="meta" style={{ textAlign: "center", padding: "16px" }}>
              Loading…
            </div>
          )}
          {error && !loading && (
            <div className="notice notice-error">{error}</div>
          )}
          {!loading && !error && items.length === 0 && (
            <div
              className="card"
              style={{
                textAlign: "center",
                padding: "48px 24px",
                fontSize: "17px",
                color: "var(--ink-2)",
              }}
            >
              No notifications yet.
            </div>
          )}

          {items.length > 0 && (
            <div className="card" style={{ padding: "6px" }}>
              {items.map((n, i) => {
                const unread = !n.readAt;
                return (
                  <div key={n.id}>
                    {i > 0 && (
                      <hr className="divider" style={{ margin: "0 14px" }} />
                    )}
                    <Link
                      href={hrefFor(n)}
                      className="link-quiet"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "14px",
                        padding: "14px",
                        borderRadius: "var(--radius-md)",
                        background: unread ? "var(--accent-soft)" : "transparent",
                        color: "var(--ink)",
                      }}
                    >
                      <Avatar
                        handle={n.actor?.handle ?? "?"}
                        name={n.actor?.name ?? null}
                        size={40}
                      />
                      <div style={{ flex: 1, minWidth: 0, fontSize: "15px" }}>
                        <div>
                          <span style={{ fontWeight: 600 }}>
                            {n.actor ? `@${n.actor.handle}` : "Someone"}
                          </span>{" "}
                          <span style={{ color: "var(--ink-2)" }}>
                            {actionText(n.type)}
                          </span>
                        </div>
                        <div
                          className="meta"
                          style={{ fontSize: "13px", marginTop: "2px" }}
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
                            background: "var(--accent-ink)",
                            flexShrink: 0,
                          }}
                        />
                      )}
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
