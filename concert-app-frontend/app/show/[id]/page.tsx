"use client";

import { useEffect, useState } from "react";
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

export default function ShowPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [show, setShow] = useState<ShowDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
            <div style={{ color: "#aaa", fontSize: "13px" }}>
              {new Date(show.localDate).toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </div>
            <h1 style={{ fontSize: "32px", margin: "4px 0 8px" }}>
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
            <div style={{ color: "#bbb", marginBottom: "8px" }}>
              {show.venue.name} • {show.venue.city}
            </div>
            <div style={{ color: "#aaa", marginBottom: "28px" }}>
              {show.averageRating} ★ • {show.reviewCount}{" "}
              {show.reviewCount === 1 ? "Review" : "Reviews"}
            </div>

            {show.reviews.length === 0 && (
              <div
                style={{
                  background: "#1a1a1a",
                  padding: "18px",
                  borderRadius: "16px",
                  color: "#aaa",
                }}
              >
                No reviews of this show yet.
              </div>
            )}

            {show.reviews.map((review) => (
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
