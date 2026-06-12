"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authHeaders, clearSession, useAuthUser } from "./lib/auth";
import LikeButton from "./components/LikeButton";
import StarRating from "./components/StarRating";
import Avatar from "./components/Avatar";

type FeedScope = "all" | "following";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type FeedItem = {
  reviewId: string;
  userHandle: string;
  userName: string | null;
  userAvatarUrl: string | null;
  ratingOverall: number;
  reviewTextRaw: string;
  publishedAt: string;
  likeCount: number;
  liked: boolean;
  show: {
    id: string;
    localDate: string;
    artistId: string;
    artist: string;
    venue: string;
    city: string;
  };
};

export default function Home() {
  const router = useRouter();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<FeedScope>("all");
  const authUser = useAuthUser();

  // Read ?scope= from URL on mount so the toggle is bookmarkable
  // and survives refresh. Falls back to "all" if no/unknown scope.
  // Deferred to a microtask so setState isn't synchronous within the
  // effect body (matches the async-load pattern used elsewhere and
  // keeps react-hooks/set-state-in-effect happy).
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      const sp = new URLSearchParams(window.location.search);
      if (sp.get("scope") === "following") setScope("following");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function selectScope(next: FeedScope) {
    if (next === scope) return;
    setScope(next);
    // Reflect in URL for shareable links / refresh persistence.
    const path = next === "following" ? "/?scope=following" : "/";
    router.replace(path);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const url =
          scope === "following"
            ? `${API_BASE}/feed?scope=following`
            : `${API_BASE}/feed`;
        const res = await fetch(url, { headers: authHeaders() });
        if (!res.ok) {
          if (!cancelled)
            setError("Couldn't load the feed. Try refreshing.");
          return;
        }
        const data = await res.json();
        if (!cancelled) setFeed(data.items || []);
      } catch {
        if (!cancelled) setError("Couldn't load the feed. Try refreshing.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [scope]);

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
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: "12px",
            fontSize: "14px",
            marginBottom: "16px",
            color: "#aaa",
            minHeight: "20px",
          }}
        >
          {authUser ? (
            <>
              <span>@{authUser.handle}</span>
              <span style={{ color: "#444" }}>·</span>
              <Link
                href="/settings"
                style={{
                  color: "#f4f1ea",
                  textDecoration: "underline",
                  textUnderlineOffset: "3px",
                }}
              >
                Settings
              </Link>
              <span style={{ color: "#444" }}>·</span>
              <button
                onClick={() => clearSession()}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  color: "#f4f1ea",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontFamily: "inherit",
                  textDecoration: "underline",
                  textUnderlineOffset: "3px",
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/signin"
                style={{
                  color: "#f4f1ea",
                  textDecoration: "underline",
                  textUnderlineOffset: "3px",
                }}
              >
                Sign in
              </Link>
              <span style={{ color: "#444" }}>·</span>
              <Link
                href="/signup"
                style={{
                  color: "#f4f1ea",
                  textDecoration: "underline",
                  textUnderlineOffset: "3px",
                }}
              >
                Sign up
              </Link>
            </>
          )}
        </div>

        <h1
          style={{
            fontSize: "34px",
            marginBottom: "8px",
            fontFamily: "var(--font-display), sans-serif",
            fontWeight: 700,
            letterSpacing: "-0.02em",
          }}
        >
          Afterset
        </h1>
        <p style={{ color: "#aaa", marginBottom: "24px" }}>
          Review concerts. Discover the best live shows.
        </p>

        <Link
          href="/review/new"
          style={{
            display: "block",
            width: "100%",
            padding: "14px",
            borderRadius: "12px",
            background: "#f4f1ea",
            color: "#0a0a0a",
            fontWeight: "bold",
            textAlign: "center",
            textDecoration: "none",
            marginBottom: "32px",
          }}
        >
          + Write a Review
        </Link>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "14px",
          }}
        >
          <h2 style={{ margin: 0 }}>Live Feed</h2>
          <div
            style={{
              display: "flex",
              gap: "16px",
              padding: 0,
            }}
            role="tablist"
            aria-label="Feed scope"
          >
            {(["all", "following"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => selectScope(mode)}
                role="tab"
                aria-selected={scope === mode}
                style={{
                  background: "transparent",
                  color: scope === mode ? "#f4f1ea" : "#666",
                  border: "none",
                  borderBottom:
                    scope === mode
                      ? "2px solid #c8b6ff"
                      : "2px solid transparent",
                  padding: "6px 0",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: scope === mode ? "bold" : "normal",
                  fontFamily: "inherit",
                }}
              >
                {mode === "all" ? "All" : "Following"}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div style={{ color: "#888", fontSize: "14px", padding: "8px 0" }}>
            Loading…
          </div>
        )}

        {!loading && error && (
          <div
            style={{
              background: "#1f1f1f",
              padding: "16px",
              borderRadius: "12px",
              color: "#ff8080",
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && feed.length === 0 && (
          <div
            style={{
              background: "#1a1a1a",
              padding: "18px",
              borderRadius: "14px",
              color: "#aaa",
            }}
          >
            {scope === "following" ? (
              authUser ? (
                <>
                  You&rsquo;re not following anyone yet. Open a user&rsquo;s
                  profile to follow them.
                </>
              ) : (
                <>
                  <Link
                    href="/signin?next=/?scope=following"
                    style={{
                      color: "#f4f1ea",
                      textDecoration: "underline",
                      textUnderlineOffset: "3px",
                    }}
                  >
                    Sign in
                  </Link>{" "}
                  to see reviews from people you follow.
                </>
              )
            ) : authUser ? (
              "No reviews yet. Be the first to write one."
            ) : (
              "No reviews yet. Sign up to write the first one."
            )}
          </div>
        )}

        {feed.map((item) => (
          <div
            key={item.reviewId}
            style={{
              padding: "28px 0",
              borderBottom: "1px solid #1f1f1f",
              position: "relative",
            }}
          >
            {/* Overlay link covers the whole card; inner @user link and
                ♥ button re-enable pointer events to stay clickable. */}
            <Link
              href={`/show/${item.show.id}`}
              aria-label={`View show: ${item.show.artist} at ${item.show.venue}`}
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 0,
              }}
            />
            <div
              style={{
                position: "relative",
                zIndex: 1,
                pointerEvents: "none",
                display: "flex",
                gap: "12px",
              }}
            >
              <Link
                href={`/user/${item.userHandle}`}
                aria-label={`View @${item.userHandle}`}
                style={{
                  pointerEvents: "auto",
                  position: "relative",
                  flexShrink: 0,
                  textDecoration: "none",
                }}
              >
                <Avatar
                  handle={item.userHandle}
                  name={item.userName}
                  avatarUrl={item.userAvatarUrl}
                  size={36}
                />
              </Link>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "15px" }}>
                  {item.userName && (
                    <span
                      style={{ color: "white", fontWeight: "bold" }}
                    >
                      {item.userName}{" "}
                    </span>
                  )}
                  <Link
                    href={`/user/${item.userHandle}`}
                    style={{
                      color: "#f4f1ea",
                      textDecoration: "underline",
                      textUnderlineOffset: "3px",
                      fontWeight: item.userName ? "normal" : "bold",
                      pointerEvents: "auto",
                      position: "relative",
                    }}
                  >
                    @{item.userHandle}
                  </Link>
                  <span style={{ color: "#aaa" }}> reviewed </span>
                  <span style={{ color: "white", fontWeight: "bold" }}>
                    {item.show.artist}
                  </span>
                </div>
                <div
                  style={{
                    color: "#aaa",
                    fontSize: "14px",
                    marginTop: "4px",
                  }}
                >
                  {item.show.venue}
                  <span style={{ color: "#555", margin: "0 6px" }}>·</span>
                  {new Date(item.show.localDate).toLocaleDateString(
                    undefined,
                    {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    },
                  )}
                </div>
                <div style={{ marginTop: "8px" }}>
                  <StarRating rating={item.ratingOverall} />
                </div>
                <div style={{ marginTop: "10px" }}>
                  {item.reviewTextRaw}
                </div>
                <div
                  style={{
                    marginTop: "12px",
                    pointerEvents: "auto",
                    position: "relative",
                    display: "inline-block",
                  }}
                >
                  <LikeButton
                    reviewId={item.reviewId}
                    initialLiked={item.liked}
                    initialLikeCount={item.likeCount}
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
