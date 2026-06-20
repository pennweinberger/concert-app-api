"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { authHeaders } from "../../lib/auth";
import { isDeletedHandle, DELETED_USER_LABEL } from "../../lib/displayUser";
import LikeButton from "../../components/LikeButton";
import StarRating from "../../components/StarRating";
import Avatar from "../../components/Avatar";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type Review = {
  id: string;
  userHandle: string;
  userName: string | null;
  userAvatarUrl: string | null;
  ratingOverall: number;
  reviewTextRaw: string;
  likeCount: number;
  liked: boolean;
  show: {
    id: string;
    localDate: string;
    // Optional during the brief window where the frontend has deployed
    // ahead of the backend (the `venue` field was added in the same push).
    venue?: { name: string; city: string };
  };
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
        const res = await fetch(`${API_BASE}/artists/${id}`, {
          headers: authHeaders(),
        });
        if (!res.ok) {
          if (!cancelled)
            setError(
              res.status === 404
                ? "Artist not found."
                : "Couldn't load this artist. Try refreshing.",
            );
          return;
        }
        const data: Artist = await res.json();
        if (!cancelled) setArtist(data);
      } catch {
        if (!cancelled) setError("Couldn't load this artist. Try refreshing.");
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

        {artist && (
          <>
            <h1
              style={{
                fontSize: "38px",
                marginBottom: "10px",
                fontFamily: "var(--font-display), sans-serif",
                fontWeight: 700,
                letterSpacing: "-0.02em",
              }}
            >
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
                  padding: "28px 0",
                  borderBottom: "1px solid #1f1f1f",
                  position: "relative",
                }}
              >
                <Link
                  href={`/show/${review.show.id}`}
                  aria-label={`View show at ${review.show.venue?.name ?? "venue"}`}
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
                  {isDeletedHandle(review.userHandle) ? (
                    <div
                      aria-label="deleted user"
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        background: "#2a2a2a",
                        flexShrink: 0,
                        position: "relative",
                      }}
                    />
                  ) : (
                    <Link
                      href={`/user/${review.userHandle}`}
                      aria-label={`View @${review.userHandle}`}
                      style={{
                        pointerEvents: "auto",
                        position: "relative",
                        flexShrink: 0,
                        textDecoration: "none",
                      }}
                    >
                      <Avatar
                        handle={review.userHandle}
                        name={review.userName}
                        avatarUrl={review.userAvatarUrl}
                        size={36}
                      />
                    </Link>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "15px" }}>
                      {review.userName && !isDeletedHandle(review.userHandle) && (
                        <span
                          style={{ color: "#f4f1ea", fontWeight: "bold" }}
                        >
                          {review.userName}{" "}
                        </span>
                      )}
                      {isDeletedHandle(review.userHandle) ? (
                        <span style={{ color: "#888" }}>{DELETED_USER_LABEL}</span>
                      ) : (
                        <Link
                          href={`/user/${review.userHandle}`}
                          style={{
                            color: "#f4f1ea",
                            textDecoration: "underline",
                            textUnderlineOffset: "3px",
                            fontWeight: review.userName ? "normal" : "bold",
                            pointerEvents: "auto",
                            position: "relative",
                          }}
                        >
                          @{review.userHandle}
                        </Link>
                      )}
                    </div>
                    <div
                      style={{
                        color: "#aaa",
                        fontSize: "14px",
                        marginTop: "4px",
                      }}
                    >
                      {review.show.venue?.name && (
                        <>
                          {review.show.venue.name}
                          <span style={{ color: "#555", margin: "0 6px" }}>
                            ·
                          </span>
                        </>
                      )}
                      {new Date(review.show.localDate).toLocaleDateString(
                        undefined,
                        {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        },
                      )}
                    </div>
                    <div style={{ marginTop: "8px" }}>
                      <StarRating rating={review.ratingOverall} />
                    </div>
                    <div style={{ marginTop: "10px" }}>
                      {review.reviewTextRaw}
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
                        reviewId={review.id}
                        initialLiked={review.liked}
                        initialLikeCount={review.likeCount}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </main>
  );
}
