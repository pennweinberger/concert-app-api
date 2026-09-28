"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { authHeaders, useAuthUser } from "../../lib/auth";
import AttendanceButton from "../../components/AttendanceButton";
import CommentsSection from "../../components/CommentsSection";
import ReviewItem, {
  type ReviewItemData,
} from "../../components/ReviewItem";
import LoadMore from "../../components/LoadMore";
import ReviewSurface from "../../components/ReviewSurface";
import SegmentedTabs from "../../components/SegmentedTabs";
import { STAR_PATH } from "../../components/StarRating";
import { formatShowDate } from "../../lib/dateFormat";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type Review = ReviewItemData & {
  publishedAt: string | null;
};

type ShowDetail = {
  id: string;
  localDate: string;
  artist: { id: string; name: string };
  venue: { name: string; city: string };
  averageRating: number;
  reviewCount: number;
  attendanceCount: number;
  attendedByMe: boolean;
  reviews: Review[];
  reviewsNextCursor?: string | null;
};

type SortMode = "top" | "recent";

const PAGE_SIZE = 20;

export default function ShowPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const authUser = useAuthUser();

  const [show, setShow] = useState<ShowDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortMode>("recent");
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  // True when the signed-in viewer has a review on this show. Disables
  // unattend (the server returns 409 anyway, but the UI should reflect
  // the constraint upfront).
  const hasMyReview = !!(
    authUser &&
    show?.reviews.some((r) => r.userHandle === authUser.handle)
  );

  useEffect(() => {
    if (!id) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${API_BASE}/shows/${id}?limit=${PAGE_SIZE}`,
          { headers: authHeaders() },
        );
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
        if (!cancelled) {
          setShow(data);
          setNextCursor(data.reviewsNextCursor ?? null);
        }
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

  async function loadMore() {
    if (!id || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const res = await fetch(
        `${API_BASE}/shows/${id}?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(nextCursor)}`,
        { headers: authHeaders() },
      );
      if (!res.ok) {
        setMoreError("Couldn't load more.");
        return;
      }
      const data: ShowDetail = await res.json();
      setShow((prev) => {
        if (!prev) return prev;
        const seen = new Set(prev.reviews.map((r) => r.id));
        const fresh = (data.reviews || []).filter((r) => !seen.has(r.id));
        return { ...prev, reviews: [...prev.reviews, ...fresh] };
      });
      setNextCursor(data.reviewsNextCursor ?? null);
    } catch {
      setMoreError("Couldn't load more.");
    } finally {
      setLoadingMore(false);
    }
  }

  // Rating distribution: index 0 = 5★, index 4 = 1★
  const distribution = useMemo<number[]>(() => {
    const counts = [0, 0, 0, 0, 0];
    if (!show) return counts;
    for (const r of show.reviews) {
      const idx = 5 - r.ratingOverall;
      if (idx >= 0 && idx < 5) counts[idx] = (counts[idx] ?? 0) + 1;
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

  const dateLabel = show
    ? formatShowDate(show.localDate, { weekday: true, alwaysYear: true })
    : "";

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
          Feed
        </Link>

        {loading && (
          <div aria-busy="true" style={{ padding: "24px 0 48px" }}>
            <span className="sr-only">Loading…</span>
            <div className="skeleton" style={{ width: "30%", height: "14px" }} />
            <div className="skeleton" style={{ width: "65%", height: "56px", marginTop: "16px" }} />
            <div className="skeleton" style={{ width: "40%", height: "20px", marginTop: "16px" }} />
          </div>
        )}

        {!loading && error && (
          <div className="notice notice-error" style={{ margin: "16px 0 48px" }}>
            {error}
          </div>
        )}

        {show && (
          <>
            {/* --- Header: Date -> Artist -> Venue --- */}
            <header style={{ paddingTop: "16px" }}>
              <div className="eyebrow">{dateLabel}</div>
              <h1
                style={{
                  margin: "10px 0 0",
                  fontSize: "clamp(40px, 6.4vw, 72px)",
                  lineHeight: 0.98,
                  fontWeight: 700,
                  letterSpacing: "-0.05em",
                }}
              >
                <Link href={`/artist/${show.artist.id}`} className="link-quiet">
                  {show.artist.name}
                </Link>
              </h1>
              <div
                style={{
                  marginTop: "12px",
                  fontSize: "clamp(17px, 1.8vw, 20px)",
                  fontWeight: 500,
                  letterSpacing: "-0.012em",
                }}
              >
                {show.venue.name}
                <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                  {" · "}
                  {show.venue.city}
                </span>
              </div>
            </header>

            {/* --- Stats: average rating is a primary fact of the page --- */}
            <dl
              style={{
                margin: "28px 0 0",
                padding: "18px 0",
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                borderTop: "1px solid var(--line)",
                borderBottom: "1px solid var(--line)",
                maxWidth: "520px",
              }}
            >
              {[
                {
                  label: "Average",
                  value:
                    show.reviewCount > 0 ? show.averageRating.toFixed(1) : "—",
                  star: show.reviewCount > 0,
                },
                {
                  label: show.reviewCount === 1 ? "Review" : "Reviews",
                  value: String(show.reviewCount),
                },
                { label: "Attended", value: String(show.attendanceCount) },
              ].map((stat, i) => (
                <div
                  key={stat.label}
                  style={{
                    display: "flex",
                    flexDirection: "column-reverse",
                    gap: "4px",
                    paddingLeft: i === 0 ? 0 : "18px",
                    borderLeft: i === 0 ? "none" : "1px solid var(--line)",
                  }}
                >
                  <dt style={{ fontSize: "12.5px", color: "var(--muted)" }}>
                    {stat.label}
                  </dt>
                  <dd
                    style={{
                      margin: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                      fontSize: "28px",
                      fontWeight: 700,
                      letterSpacing: "-0.04em",
                      lineHeight: 1,
                    }}
                  >
                    {stat.value}
                    {stat.star && (
                      <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
                        <path d={STAR_PATH} fill="var(--ink)" />
                      </svg>
                    )}
                  </dd>
                </div>
              ))}
            </dl>

            {/* --- Equal secondary actions --- */}
            {/* Grid (not flex) so the pair is exactly equal-width. */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "10px",
                margin: "22px 0 40px",
                maxWidth: "520px",
              }}
            >
              <Link
                href={`/review/new?showId=${show.id}`}
                className="peer-action"
                style={{
                  minWidth: 0,
                  height: "52px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "7px",
                  padding: "0 10px",
                  fontSize: "clamp(14px, 3.9vw, 15px)",
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                  // border + background intentionally omitted: .peer-action
                  // owns them so hover/focus can take effect. An inline
                  // declaration here would outrank the stylesheet.
                  borderRadius: "999px",
                  textDecoration: "none",
                  boxSizing: "border-box",
                  whiteSpace: "nowrap",
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M4 20h4L19 9l-4-4L4 16z" />
                </svg>
                Write Review
              </Link>
              <div style={{ minWidth: 0 }}>
                <AttendanceButton
                  showId={show.id}
                  initialAttended={show.attendedByMe}
                  initialAttendanceCount={show.attendanceCount}
                  blockedByReview={hasMyReview}
                  onChange={({ attended, attendanceCount }) => {
                    setShow((prev) =>
                      prev
                        ? { ...prev, attendedByMe: attended, attendanceCount }
                        : prev,
                    );
                  }}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {show && (
        <section className="band">
          <div
            className="container-md"
            style={{
              paddingTop: "clamp(28px, 4vw, 48px)",
              paddingBottom: "clamp(40px, 6vw, 80px)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "12px",
                marginBottom: "20px",
              }}
            >
              <h2 className="h3" style={{ fontSize: "clamp(22px, 2.4vw, 28px)" }}>
                Reviews
              </h2>
              {/* --- Sort toggle (only if there are reviews to sort) --- */}
              {show.reviews.length > 1 && (
                <SegmentedTabs
                  label="Review sort"
                  value={sort}
                  onChange={setSort}
                  options={[
                    { value: "recent", label: "Recent" },
                    { value: "top", label: "Top" },
                  ]}
                />
              )}
            </div>

            {/* --- Reviews: the primary content --- */}
            {show.reviews.length === 0 && (
              <div
                className="card"
                style={{
                  textAlign: "center",
                  padding: "48px 24px",
                  fontSize: "17px",
                  color: "var(--ink-2)",
                }}
              >
                No reviews of this show yet. Be the first.
              </div>
            )}

            {sortedReviews.length > 0 && (
              <div className="stack" style={{ gap: "14px" }}>
                {sortedReviews.map((review) => (
                  <ReviewSurface key={review.id}>
                    <ReviewItem
                      review={review}
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

            {nextCursor && (
              <div style={{ marginTop: "32px" }}>
                <LoadMore
                  onClick={loadMore}
                  loading={loadingMore}
                  error={moreError}
                />
              </div>
            )}

            {/* --- Rating breakdown: available, not competing --- */}
            {show.reviewCount > 0 && (
              <div
                className="card"
                style={{ marginTop: "20px", padding: 0, overflow: "hidden" }}
              >
                <button
                  onClick={() => setBreakdownOpen((o) => !o)}
                  aria-expanded={breakdownOpen}
                  style={{
                    width: "100%",
                    height: "56px",
                    padding: "0 22px",
                    background: "none",
                    border: "none",
                    fontFamily: "inherit",
                    fontSize: "15px",
                    fontWeight: 500,
                    color: "var(--ink)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  Rating breakdown
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--muted)"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    style={{
                      display: "block",
                      transform: breakdownOpen ? "rotate(90deg)" : "none",
                      transition: "transform 130ms ease",
                    }}
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>

                {breakdownOpen && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      padding: "0 22px 20px",
                      maxWidth: "460px",
                    }}
                  >
                    {[5, 4, 3, 2, 1].map((stars) => {
                      const count = distribution[5 - stars] ?? 0;
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
                            fontSize: "13px",
                            color: "var(--muted)",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          <span style={{ width: "28px", textAlign: "right" }}>
                            {stars}★
                          </span>
                          <div
                            style={{
                              flex: 1,
                              height: "6px",
                              background: "var(--surface-2)",
                              borderRadius: "999px",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${pct}%`,
                                height: "100%",
                                borderRadius: "999px",
                                background: "var(--ink)",
                              }}
                            />
                          </div>
                          <span style={{ width: "20px" }}>{count}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
