"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { authHeaders } from "../../lib/auth";
import StarRating from "../../components/StarRating";
import CommentsSection from "../../components/CommentsSection";
import ReviewItem, {
  type ReviewItemData,
} from "../../components/ReviewItem";
import LoadMore from "../../components/LoadMore";
import ReviewSurface from "../../components/ReviewSurface";
import SegmentedTabs from "../../components/SegmentedTabs";
import { formatShowDate } from "../../lib/dateFormat";

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
    <main className="page">
      <div className="container-md" style={{ paddingTop: "20px" }}>
        <Link
          href="/"
          className="link"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "2px",
            minHeight: "40px",
            fontSize: "15px",
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Back
        </Link>

        {loading && !artist && (
          <div aria-busy="true" style={{ padding: "24px 0 48px" }}>
            <span className="sr-only">Loading…</span>
            <div className="skeleton" style={{ width: "55%", height: "56px" }} />
            <div className="skeleton" style={{ width: "35%", height: "20px", marginTop: "16px" }} />
          </div>
        )}

        {!loading && error && (
          <div className="notice notice-error" style={{ margin: "16px 0 48px" }}>
            {error}
          </div>
        )}

        {artist && (
          <header style={{ paddingTop: "16px", paddingBottom: "40px" }}>
            {/* --- Artist summary --- */}
            <h1
              style={{
                margin: 0,
                fontSize: "clamp(40px, 6.4vw, 72px)",
                lineHeight: 0.98,
                fontWeight: 700,
                letterSpacing: "-0.05em",
              }}
            >
              {artist.name}
            </h1>

            {artist.reviewCount > 0 ? (
              <dl
                style={{
                  margin: "28px 0 0",
                  padding: "18px 0",
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  borderTop: "1px solid var(--line)",
                  borderBottom: "1px solid var(--line)",
                  maxWidth: "400px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column-reverse",
                    gap: "6px",
                  }}
                >
                  <dt style={{ fontSize: "12.5px", color: "var(--muted)" }}>
                    Average
                  </dt>
                  <dd
                    style={{
                      margin: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      fontSize: "28px",
                      fontWeight: 700,
                      letterSpacing: "-0.04em",
                      lineHeight: 1,
                    }}
                  >
                    {artist.averageRating.toFixed(1)}
                    <StarRating
                      rating={Math.round(artist.averageRating)}
                      size={15}
                    />
                  </dd>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column-reverse",
                    gap: "6px",
                    paddingLeft: "18px",
                    borderLeft: "1px solid var(--line)",
                  }}
                >
                  <dt style={{ fontSize: "12.5px", color: "var(--muted)" }}>
                    {artist.reviewCount === 1 ? "Review" : "Reviews"}
                  </dt>
                  <dd
                    style={{
                      margin: 0,
                      fontSize: "28px",
                      fontWeight: 700,
                      letterSpacing: "-0.04em",
                      lineHeight: 1,
                    }}
                  >
                    {artist.reviewCount}
                  </dd>
                </div>
              </dl>
            ) : (
              <div
                style={{
                  marginTop: "14px",
                  fontSize: "clamp(17px, 1.8vw, 20px)",
                  color: "var(--muted)",
                }}
              >
                No reviews yet
              </div>
            )}
          </header>
        )}
      </div>

      {artist && (
        <section className="band">
          <div
            className="container-md"
            style={{
              paddingTop: "clamp(28px, 4vw, 48px)",
              paddingBottom: "clamp(40px, 6vw, 80px)",
            }}
          >
            {/* --- Reviews section: heading + sort --- */}
            {artist.reviewCount > 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  // center, not baseline: baseline-aligning a pill against
                  // a heading sits it low.
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "12px",
                  marginBottom: "20px",
                }}
              >
                <h2 className="h3" style={{ fontSize: "clamp(22px, 2.4vw, 28px)" }}>
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
                className="card"
                style={{
                  textAlign: "center",
                  padding: "48px 24px",
                  fontSize: "17px",
                  color: "var(--ink-2)",
                }}
              >
                No reviews of {artist.name} yet.
              </div>
            )}

            {current.reviews.length > 0 && (
              <div
                className="stack"
                style={{
                  gap: "14px",
                  opacity: loading ? 0.5 : 1,
                  transition: "opacity 120ms ease",
                }}
              >
                {current.reviews.map((review) => (
                  <ReviewSurface key={review.id}>
                    <ReviewItem
                      review={review}
                      context={
                        // Performance context — the venue/date IS the story
                        // on this page, and links to that specific show.
                        <Link
                          href={`/show/${review.show.id}`}
                          className="link-quiet"
                          style={{ display: "inline-block" }}
                        >
                          {review.show.venue?.name && (
                            <div
                              style={{
                                fontSize: "15px",
                                fontWeight: 600,
                                letterSpacing: "-0.01em",
                              }}
                            >
                              {review.show.venue.name}
                            </div>
                          )}
                          <div
                            className="meta"
                            style={{ marginTop: "2px" }}
                          >
                            {formatShowDate(review.show.localDate, {
                              longMonth: true,
                              alwaysYear: true,
                            })}
                          </div>
                        </Link>
                      }
                      actions={
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <CommentsSection
                            reviewId={review.id}
                            initialCount={review.commentCount}
                          />
                        </div>
                      }
                    />
                  </ReviewSurface>
                ))}
              </div>
            )}

            {hasMore && (
              <div style={{ marginTop: "32px" }}>
                <LoadMore
                  onClick={loadMore}
                  loading={loadingMore}
                  error={moreError}
                />
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
