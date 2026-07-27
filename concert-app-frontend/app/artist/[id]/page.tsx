"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { authHeaders } from "../../lib/auth";
import Masthead from "../../components/Masthead";
import StarRating from "../../components/StarRating";
import CommentsSection from "../../components/CommentsSection";
import ReviewItem, {
  type ReviewItemData,
} from "../../components/ReviewItem";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type Review = ReviewItemData & {
  show: {
    id: string;
    localDate: string;
    // Optional for resilience if the backend ever omits it.
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

type SortMode = "top" | "recent";

const CREAM = "#f4f1ea";

export default function ArtistPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [artist, setArtist] = useState<Artist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Top is the default: the artist page is about which performances
  // resonated most across the whole history, not the latest activity.
  const [sort, setSort] = useState<SortMode>("top");

  useEffect(() => {
    if (!id) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Sorting is server-side so "Top" ranks the artist's entire
        // review history, not just the most recent page.
        const res = await fetch(`${API_BASE}/artists/${id}?sort=${sort}`, {
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
  }, [id, sort]);

  return (
    <main
      style={{
        background: "#0a0a0a",
        minHeight: "100vh",
        color: CREAM,
        padding: "24px",
      }}
    >
      <div style={{ maxWidth: "700px", margin: "0 auto" }}>
        <Masthead />

        <div style={{ marginTop: "24px" }}>
          <Link
            href="/"
            style={{
              color: "#6f6f6f",
              fontSize: "13px",
              textDecoration: "none",
            }}
          >
            ← Back
          </Link>
        </div>

        {loading && !artist && (
          <div style={{ color: "#888", fontSize: "14px", padding: "20px 0" }}>
            Loading…
          </div>
        )}

        {!loading && error && (
          <div
            style={{ color: "#ff8080", fontSize: "14px", padding: "20px 0" }}
          >
            {error}
          </div>
        )}

        {artist && (
          <>
            {/* --- Artist summary --- */}
            <div style={{ marginTop: "18px" }}>
              <h1
                style={{
                  margin: 0,
                  fontSize: "32px",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  lineHeight: 1.1,
                }}
              >
                {artist.name}
              </h1>

              {artist.reviewCount > 0 ? (
                <>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: "11px",
                      marginTop: "14px",
                    }}
                  >
                    <StarRating
                      rating={Math.round(artist.averageRating)}
                      size={15}
                      filledColor={CREAM}
                      emptyColor="#333"
                    />
                    <span
                      style={{
                        fontSize: "22px",
                        fontWeight: 700,
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {artist.averageRating}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: "14px",
                      color: "#8a8a8a",
                      marginTop: "6px",
                    }}
                  >
                    {artist.reviewCount}{" "}
                    {artist.reviewCount === 1 ? "review" : "reviews"}
                  </div>
                </>
              ) : (
                <div
                  style={{
                    fontSize: "14px",
                    color: "#8a8a8a",
                    marginTop: "14px",
                  }}
                >
                  No reviews yet
                </div>
              )}
            </div>

            {/* --- Reviews section: heading + sort --- */}
            {artist.reviewCount > 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginTop: "38px",
                }}
              >
                <h2
                  style={{
                    margin: 0,
                    fontSize: "15px",
                    fontWeight: 600,
                    letterSpacing: "-0.01em",
                  }}
                >
                  Reviews
                </h2>
                <div
                  style={{ display: "flex", gap: "16px" }}
                  role="tablist"
                  aria-label="Review sort"
                >
                  {(["top", "recent"] as const).map((mode) => {
                    const active = sort === mode;
                    return (
                      <button
                        key={mode}
                        onClick={() => setSort(mode)}
                        role="tab"
                        aria-selected={active}
                        style={{
                          background: "transparent",
                          border: "none",
                          borderBottom: active
                            ? "2px solid #f4f1ea"
                            : "2px solid transparent",
                          padding: "4px 0",
                          cursor: "pointer",
                          fontSize: "13px",
                          fontFamily: "inherit",
                          color: active ? CREAM : "#666",
                          fontWeight: active ? 600 : 400,
                        }}
                      >
                        {mode === "top" ? "Top" : "Recent"}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {artist.reviews.length === 0 && !loading && (
              <div
                style={{
                  color: "#888",
                  fontSize: "15px",
                  padding: "24px 0",
                  lineHeight: 1.6,
                }}
              >
                No reviews of {artist.name} yet.
              </div>
            )}

            {artist.reviews.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "58px",
                  marginTop: "34px",
                  opacity: loading ? 0.5 : 1,
                  transition: "opacity 120ms ease",
                }}
              >
                {artist.reviews.map((review) => (
                  <ReviewItem
                    key={review.id}
                    review={review}
                    context={
                      // Performance context — the venue/date IS the story
                      // on this page, and links to that specific show.
                      <Link
                        href={`/show/${review.show.id}`}
                        style={{
                          display: "inline-block",
                          textDecoration: "none",
                        }}
                      >
                        {review.show.venue?.name && (
                          <div
                            style={{
                              fontSize: "15px",
                              fontWeight: 500,
                              color: "#d8d1c2",
                            }}
                          >
                            {review.show.venue.name}
                          </div>
                        )}
                        <div
                          style={{
                            fontSize: "13.5px",
                            color: "#6f6f6f",
                            marginTop: "2px",
                          }}
                        >
                          {new Date(review.show.localDate).toLocaleDateString(
                            undefined,
                            {
                              year: "numeric",
                              month: "long",
                              day: "numeric",
                            },
                          )}
                        </div>
                      </Link>
                    }
                    actions={
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <CommentsSection
                          reviewId={review.id}
                          initialCount={review.commentCount}
                          variant="editorial"
                        />
                      </div>
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
