"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type Review = {
  id: string;
  userHandle: string;
  ratingOverall: number;
  reviewTextRaw: string;
};

type Artist = {
  id: string;
  name: string;
  averageRating: number;
  reviewCount: number;
  reviews: Review[];
};

export default function ArtistPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [artist, setArtist] = useState<Artist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/artists/${id}`);
        if (!res.ok) {
          if (res.status === 404) {
            if (!cancelled) setError("Artist not found");
          } else {
            if (!cancelled) setError(`Failed to load artist (${res.status})`);
          }
          return;
        }
        const data: Artist = await res.json();
        if (!cancelled) setArtist(data);
      } catch {
        if (!cancelled) setError("Failed to load artist");
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

        {loading && <div style={{ color: "#aaa" }}>Loading…</div>}

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

        {artist && (
          <>
            <h1 style={{ fontSize: "38px", marginBottom: "10px" }}>
              {artist.name}
            </h1>

            <div style={{ color: "#aaa", marginBottom: "24px" }}>
              {artist.averageRating} ★ • {artist.reviewCount}{" "}
              {artist.reviewCount === 1 ? "Review" : "Reviews"}
            </div>

            {artist.reviews.length === 0 && (
              <div
                style={{
                  background: "#1a1a1a",
                  padding: "18px",
                  borderRadius: "16px",
                  color: "#aaa",
                }}
              >
                No reviews yet.
              </div>
            )}

            {artist.reviews.map((review) => (
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
                  {review.ratingOverall}/5
                </div>
                <div style={{ marginTop: "8px" }}>{review.reviewTextRaw}</div>
                <div style={{ color: "#888", marginTop: "8px" }}>
                  @{review.userHandle}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </main>
  );
}
