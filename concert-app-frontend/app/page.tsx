"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`${API_BASE}/feed`);
        const data = await res.json();
        if (!cancelled) setFeed(data.items || []);
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

        {loading && <div style={{ color: "#aaa" }}>Loading…</div>}

        {!loading && feed.length === 0 && (
          <div
            style={{
              background: "#1a1a1a",
              padding: "18px",
              borderRadius: "14px",
              color: "#aaa",
            }}
          >
            No reviews yet. Be the first.
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
              @{item.userHandle} reviewed{" "}
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
              {item.show.venue}
            </div>
            <div style={{ marginTop: "8px" }}>{item.reviewTextRaw}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
