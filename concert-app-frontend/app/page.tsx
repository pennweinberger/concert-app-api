"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { clearSession, useAuthUser } from "./lib/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type FeedItem = {
  reviewId: string;
  userHandle: string;
  ratingOverall: number;
  reviewTextRaw: string;
  publishedAt: string;
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
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const authUser = useAuthUser();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`${API_BASE}/feed`);
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
  }, []);

  return (
    <main
      style={{
        background: "#0f0f0f",
        minHeight: "100vh",
        color: "white",
        padding: "24px",
        fontFamily: "Arial, sans-serif",
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
              <button
                onClick={() => clearSession()}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  color: "#7dafff",
                  cursor: "pointer",
                  fontSize: "14px",
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/signin" style={{ color: "#7dafff" }}>
                Sign in
              </Link>
              <span style={{ color: "#444" }}>·</span>
              <Link href="/signup" style={{ color: "#7dafff" }}>
                Sign up
              </Link>
            </>
          )}
        </div>

        <h1 style={{ fontSize: "34px", marginBottom: "8px" }}>Afterset</h1>
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
            background: "#2d6cff",
            color: "white",
            fontWeight: "bold",
            textAlign: "center",
            textDecoration: "none",
            marginBottom: "32px",
          }}
        >
          + Write a Review
        </Link>

        <h2 style={{ marginBottom: "14px" }}>Live Feed</h2>

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
            {authUser
              ? "No reviews yet. Be the first to write one."
              : "No reviews yet. Sign up to write the first one."}
          </div>
        )}

        {feed.map((item) => (
          <div
            key={item.reviewId}
            style={{
              background: "#1a1a1a",
              padding: "16px",
              borderRadius: "14px",
              marginBottom: "12px",
            }}
          >
            <div style={{ fontWeight: "bold" }}>
              <Link
                href={`/user/${item.userHandle}`}
                style={{ color: "#7dafff", textDecoration: "none" }}
              >
                @{item.userHandle}
              </Link>{" "}
              reviewed{" "}
              <Link
                href={`/artist/${item.show.artistId}`}
                style={{ color: "#7dafff", textDecoration: "underline" }}
              >
                {item.show.artist}
              </Link>{" "}
              • {item.ratingOverall}/5
            </div>
            <div
              style={{ color: "#aaa", fontSize: "14px", marginTop: "4px" }}
            >
              <Link
                href={`/show/${item.show.id}`}
                style={{ color: "#aaa", textDecoration: "none" }}
              >
                {item.show.venue}
                <span style={{ color: "#555", margin: "0 6px" }}>·</span>
                {new Date(item.show.localDate).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </Link>
            </div>
            <div style={{ marginTop: "8px" }}>{item.reviewTextRaw}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
