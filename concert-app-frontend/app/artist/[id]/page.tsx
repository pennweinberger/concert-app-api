"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { authHeaders } from "../../lib/auth";
import Masthead from "../../components/Masthead";
import StarRating from "../../components/StarRating";
import CommentsSection from "../../components/CommentsSection";
import ReviewItem, {
  type ReviewItemData,
} from "../../components/ReviewItem";
import LoadMore from "../../components/LoadMore";
import PageGlow from "../../components/PageGlow";
import ReviewSurface from "../../components/ReviewSurface";
import SegmentedTabs from "../../components/SegmentedTabs";

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
  reviewsNextCursor?: string | null;
  topNextOffset?: number | null;
};

type SortMode = "top" | "recent";

const CREAM = "#f4f1ea";
const PAGE_SIZE = 20;

/**
 * Per-sort loaded state. Top and Recent are independent streams — and
 * they paginate differently (Top by offset, Recent by cursor) — so each
 * keeps its own accumulated reviews and its own position. Switching
 * tabs restores whatever was already loaded instead of refetching.
 */
type SortState = {
  reviews: Review[];
  cursor: string | null;
  offset: number | null;
  loaded: boolean;
};

const EMPTY_SORT_STATE: SortState = {
  reviews: [],
  cursor: null,
  offset: null,
  loaded: false,
};

export default function ArtistPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [artist, setArtist] = useState<Artist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Top is the default: the artist page is about which performances
  // resonated most across the whole history, not the latest activity.
  const [sort, setSort] = useState<SortMode>("top");
  const [sortState, setSortState] = useState<Record<SortMode, SortState>>({
    top: EMPTY_SORT_STATE,
    recent: EMPTY_SORT_STATE,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const current = sortState[sort];
  // Which sorts have been fetched. Held in a ref, not state, so the load
  // effect doesn't re-run every time the loaded data itself changes.
  const loadedSorts = useRef<Record<SortMode, boolean>>({
    top: false,
    recent: false,
  });

  useEffect(() => {
    if (!id) return;
    // Already loaded this sort — restore it rather than refetching.
    if (loadedSorts.current[sort]) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setMoreError(null);
      try {
        // Sorting is server-side so "Top" ranks the artist's entire
        // review history, not just the most recent page.
        const res = await fetch(
          `${API_BASE}/artists/${id}?sort=${sort}&limit=${PAGE_SIZE}`,
          { headers: authHeaders() },
        );
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
        if (cancelled) return;
        setArtist(data);
        const mode = sort;
        loadedSorts.current[mode] = true;
        setSortState((prev) => ({
          ...prev,
          [mode]: {
            reviews: data.reviews || [],
            cursor: data.reviewsNextCursor ?? null,
            offset: data.topNextOffset ?? null,
            loaded: true,
          },
        }));
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

  const hasMore =
    sort === "top" ? current.offset !== null : current.cursor !== null;

  async function loadMore() {
    if (!id || loadingMore || !hasMore) return;
    setLoadingMore(true);
    setMoreError(null);
    const mode = sort;
    try {
      const page =
        mode === "top"
          ? `sort=top&limit=${PAGE_SIZE}&offset=${current.offset}`
          : `sort=recent&limit=${PAGE_SIZE}&cursor=${encodeURIComponent(current.cursor ?? "")}`;
      const res = await fetch(`${API_BASE}/artists/${id}?${page}`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        setMoreError("Couldn't load more.");
        return;
      }
      const data: Artist = await res.json();
      setSortState((prev) => {
        const existing = prev[mode];
        const seen = new Set(existing.reviews.map((r) => r.id));
        const fresh = (data.reviews || []).filter((r) => !seen.has(r.id));
        return {
          ...prev,
          [mode]: {
            reviews: [...existing.reviews, ...fresh],
            cursor: data.reviewsNextCursor ?? null,
            offset: data.topNextOffset ?? null,
            loaded: true,
          },
        };
      });
    } catch {
      setMoreError("Couldn't load more.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <main
      style={{
        background: "#0a0a0a",
        minHeight: "100vh",
        color: CREAM,
        padding: "24px",
      }}
    >
      <PageGlow />

      <div
        style={{
          maxWidth: "700px",
          margin: "0 auto",
          position: "relative",
          zIndex: 1,
        }}
      >
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
                  // center, not baseline: the sort control is now a pill,
                  // and baseline-aligning a pill against a heading sits it
                  // low.
                  alignItems: "center",
                  gap: "12px",
                  marginTop: "36px",
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
                <SegmentedTabs
                  label="Review sort"
                  value={sort}
                  onChange={setSort}
                  options={[
                    { value: "top", label: "Top" },
                    { value: "recent", label: "Recent" },
                  ]}
                />
              </div>
            )}

            {current.reviews.length === 0 && !loading && (
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

            {current.reviews.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "15px",
                  marginTop: "16px",
                  opacity: loading ? 0.5 : 1,
                  transition: "opacity 120ms ease",
                }}
              >
                {/* Rotating tints: each card is a DIFFERENT performance, so
                    the variety the rotation implies is real. */}
                {current.reviews.map((review, i) => (
                  <ReviewSurface key={review.id} tintIndex={i}>
                  <ReviewItem
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
                  </ReviewSurface>
                ))}
              </div>
            )}

            {hasMore && (
              <div style={{ marginTop: "48px" }}>
                <LoadMore
                  onClick={loadMore}
                  loading={loadingMore}
                  error={moreError}
                />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
