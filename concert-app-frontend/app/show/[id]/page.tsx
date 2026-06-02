"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { authHeaders } from "../../lib/auth";
import LikeButton from "../../components/LikeButton";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type Review = {
  id: string;
  userHandle: string;
  ratingOverall: number;
  reviewTextRaw: string;
  publishedAt: string | null;
  likeCount: number;
  liked: boolean;
};

type ShowDetail = {
  id: string;
  localDate: string;
  artist: { id: string; name: string };
  venue: { name: string; city: string };
  averageRating: number;
  reviewCount: number;
  reviews: Review[];
};

type SortMode = "top" | "recent";

export default function ShowPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [show, setShow] = useState<ShowDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortMode>("recent");

  useEffect(() => {
    if (!id) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/shows/${id}`, {
          headers: authHeaders(),
        });
        if (!res.ok) {
          if (!cancelled)
            setError(
              res.status === 404
                ? "Show not found."
                : "Couldn't load this show. Try refreshing.",
            );
          return;
        }
        const data: ShowDetail = await res.json();
        if (!cancelled) setShow(data);
      } catch {
        if (!cancelled) setError("Couldn't load this show. Try refreshing.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [id]);

  // Rating distribution: index 0 = 5★, index 4 = 1★
  const distribution = useMemo<number[]>(() => {
    const counts = [0, 0, 0, 0, 0];
    if (!show) return counts;
    for (const r of show.reviews) {
      const idx = 5 - r.ratingOverall;
      if (idx >= 0 && idx < 5) counts[idx]++;
    }
    return counts;
  }, [show]);

  const sortedReviews = useMemo<Review[]>(() => {
    if (!show) return [];
    const reviews = [...show.reviews];
    const ts = (r: Review) =>
      r.publishedAt ? new Date(r.publishedAt).getTime() : 0;
    if (sort === "top") {
      reviews.sort((a, b) => {
        if (b.likeCount !== a.likeCount) return b.likeCount - a.likeCount;
        return ts(b) - ts(a);
      });
    } else {
      reviews.sort((a, b) => ts(b) - ts(a));
    }
    return reviews;
  }, [show, sort]);

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
        <div style={{ marginBottom: "20px" }}>
          <Link href="/" style={{ color: "#7dafff" }}>
            ← Back to feed
          </Link>
        </div>

        {loading && (
          <div style={{ color: "#888", fontSize: "14px", padding: "8px 0" }}>
            Loading…
          </div>
        )}

        {error && (
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

        {show && (
          <>
            {/* --- Header --- */}
            <div
              style={{
                color: "#aaa",
                fontSize: "13px",
                textTransform: "uppercase",
                letterSpacing: "1px",
              }}
            >
              {new Date(show.localDate).toLocaleDateString(undefined, {
                weekday: "short",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </div>
            <h1
              style={{
                fontSize: "38px",
                margin: "6px 0 10px",
                lineHeight: 1.1,
              }}
            >
              <Link
                href={`/artist/${show.artist.id}`}
                style={{
                  color: "white",
                  textDecoration: "none",
                  borderBottom: "1px dotted #555",
                }}
              >
                {show.artist.name}
              </Link>
            </h1>
            <div style={{ color: "#bbb", marginBottom: "16px" }}>
              {show.venue.name} • {show.venue.city}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "10px",
                marginBottom: "14px",
              }}
            >
              <span style={{ fontSize: "28px", fontWeight: "bold" }}>
                {show.averageRating}
              </span>
              <span style={{ color: "#fbbf24", fontSize: "20px" }}>★</span>
              <span style={{ color: "#aaa", fontSize: "14px" }}>
                {show.reviewCount}{" "}
                {show.reviewCount === 1 ? "Review" : "Reviews"}
              </span>
            </div>

            {/* --- Rating distribution --- */}
            {show.reviewCount > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  marginBottom: "24px",
                }}
              >
                {[5, 4, 3, 2, 1].map((stars) => {
                  const count = distribution[5 - stars];
                  const pct =
                    show.reviewCount > 0
                      ? (count / show.reviewCount) * 100
                      : 0;
                  return (
                    <div
                      key={stars}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        fontSize: "12px",
                      }}
                    >
                      <span
                        style={{
                          color: "#aaa",
                          width: "24px",
                          textAlign: "right",
                        }}
                      >
                        {stars}★
                      </span>
                      <div
                        style={{
                          flex: 1,
                          height: "8px",
                          background: "#1a1a1a",
                          borderRadius: "4px",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: "100%",
                            background: "#fbbf24",
                          }}
                        />
                      </div>
                      <span
                        style={{
                          color: "#888",
                          width: "24px",
                          textAlign: "left",
                        }}
                      >
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* --- CTA --- */}
            <Link
              href={`/review/new?showId=${show.id}`}
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
                marginBottom: "28px",
                boxSizing: "border-box",
              }}
            >
              + Write a Review for this Show
            </Link>

            {/* --- Sort toggle (only if there are reviews to sort) --- */}
            {show.reviews.length > 1 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "14px",
                }}
              >
                <span style={{ color: "#666", fontSize: "13px" }}>Sort</span>
                {(["top", "recent"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setSort(mode)}
                    style={{
                      background: sort === mode ? "#1a1a1a" : "transparent",
                      color: sort === mode ? "white" : "#888",
                      border:
                        sort === mode
                          ? "1px solid #444"
                          : "1px solid transparent",
                      padding: "5px 12px",
                      borderRadius: "8px",
                      cursor: "pointer",
                      fontSize: "13px",
                      fontWeight: sort === mode ? "bold" : "normal",
                    }}
                  >
                    {mode === "top" ? "Top" : "Recent"}
                  </button>
                ))}
              </div>
            )}

            {/* --- Reviews list --- */}
            {show.reviews.length === 0 && (
              <div
                style={{
                  background: "#1a1a1a",
                  padding: "18px",
                  borderRadius: "16px",
                  color: "#aaa",
                }}
              >
                No reviews of this show yet. Be the first.
              </div>
            )}

            {sortedReviews.map((review) => (
              <div
                key={review.id}
                style={{
                  background: "#1a1a1a",
                  padding: "18px",
                  borderRadius: "16px",
                  marginBottom: "14px",
                }}
              >
                <div style={{ fontWeight: "bold" }}>
                  <Link
                    href={`/user/${review.userHandle}`}
                    style={{ color: "#7dafff", textDecoration: "none" }}
                  >
                    @{review.userHandle}
                  </Link>{" "}
                  • {review.ratingOverall}/5
                </div>
                <div style={{ marginTop: "8px" }}>{review.reviewTextRaw}</div>
                <div style={{ marginTop: "12px" }}>
                  <LikeButton
                    reviewId={review.id}
                    initialLiked={review.liked}
                    initialLikeCount={review.likeCount}
                  />
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </main>
  );
}
