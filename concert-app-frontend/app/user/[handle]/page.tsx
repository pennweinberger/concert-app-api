"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type Review = {
  id: string;
  ratingOverall: number;
  reviewTextRaw: string;
  publishedAt: string | null;
  show: {
    id: string;
    localDate: string;
    artist: { id: string; name: string };
    venue: { name: string; city: string };
  };
};

type UserDetail = {
  handle: string;
  reviewCount: number;
  reviews: Review[];
};

export default function UserPage() {
  const params = useParams<{ handle: string }>();
  const handle = params?.handle;

  const [user, setUser] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!handle) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/users/${handle}`);
        if (!res.ok) {
          if (res.status === 404) {
            if (!cancelled) setError(`No user @${handle}`);
          } else {
            if (!cancelled) setError(`Failed to load user (${res.status})`);
          }
          return;
        }
        const data: UserDetail = await res.json();
        if (!cancelled) setUser(data);
      } catch {
        if (!cancelled) setError("Failed to load user");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [handle]);

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

        {user && (
          <>
            <h1 style={{ fontSize: "32px", marginBottom: "6px" }}>
              @{user.handle}
            </h1>
            <div style={{ color: "#aaa", marginBottom: "28px" }}>
              {user.reviewCount}{" "}
              {user.reviewCount === 1 ? "Review" : "Reviews"}
            </div>

            {user.reviews.length === 0 && (
              <div
                style={{
                  background: "#1a1a1a",
                  padding: "18px",
                  borderRadius: "16px",
                  color: "#aaa",
                }}
              >
                Hasn&rsquo;t reviewed any shows yet.
              </div>
            )}

            {user.reviews.map((review) => (
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
                    href={`/artist/${review.show.artist.id}`}
                    style={{
                      color: "#7dafff",
                      textDecoration: "underline",
                    }}
                  >
                    {review.show.artist.name}
                  </Link>{" "}
                  • {review.ratingOverall}/5
                </div>
                <div
                  style={{
                    color: "#aaa",
                    fontSize: "14px",
                    marginTop: "4px",
                  }}
                >
                  <Link
                    href={`/show/${review.show.id}`}
                    style={{ color: "#aaa", textDecoration: "none" }}
                  >
                    {review.show.venue.name} • {review.show.venue.city}
                  </Link>
                </div>
                <div style={{ marginTop: "8px" }}>{review.reviewTextRaw}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </main>
  );
}
