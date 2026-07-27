"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { authHeaders, useAuthUser } from "../../lib/auth";
import Masthead from "../../components/Masthead";
import AttendanceButton from "../../components/AttendanceButton";
import CommentsSection from "../../components/CommentsSection";
import ReviewItem, {
  type ReviewItemData,
} from "../../components/ReviewItem";

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
};

type SortMode = "top" | "recent";

export default function ShowPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const authUser = useAuthUser();

  const [show, setShow] = useState<ShowDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortMode>("recent");
  const [breakdownOpen, setBreakdownOpen] = useState(false);

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
            ← Feed
          </Link>
        </div>

        {loading && (
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

        {show && (
          <>
            {/* --- Header: Artist -> Venue -> Date --- */}
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
                <Link
                  href={`/artist/${show.artist.id}`}
                  style={{ color: "#f4f1ea", textDecoration: "none" }}
                >
                  {show.artist.name}
                </Link>
              </h1>
              <div
                style={{ fontSize: "15px", color: "#8a8a8a", marginTop: "8px" }}
              >
                {show.venue.name} · {show.venue.city}
              </div>
              <div
                style={{ fontSize: "14px", color: "#6f6f6f", marginTop: "3px" }}
              >
                {new Date(show.localDate).toLocaleDateString(undefined, {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </div>

              {/* Average rating — a primary fact of the page, read right
                  after the artist name. */}
              {show.reviewCount > 0 ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "10px",
                    marginTop: "16px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "26px",
                      fontWeight: 700,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {show.averageRating}
                    <span
                      aria-hidden="true"
                      style={{ fontSize: "18px", marginLeft: "5px" }}
                    >
                      ★
                    </span>
                  </span>
                  <span style={{ fontSize: "14px", color: "#8a8a8a" }}>
                    {show.reviewCount}{" "}
                    {show.reviewCount === 1 ? "review" : "reviews"} ·{" "}
                    {show.attendanceCount} attended
                  </span>
                </div>
              ) : (
                <div
                  style={{
                    fontSize: "14px",
                    color: "#8a8a8a",
                    marginTop: "16px",
                  }}
                >
                  No ratings yet · {show.attendanceCount} attended
                </div>
              )}
            </div>

            {/* --- Equal secondary actions --- */}
            <div style={{ display: "flex", gap: "10px", marginTop: "18px" }}>
              <Link
                href={`/review/new?showId=${show.id}`}
                style={{
                  // minWidth:0 so the pair splits the row evenly instead of
                  // min-content widening it (which overflowed at 375px).
                  flex: "1 1 0",
                  minWidth: 0,
                  textAlign: "center",
                  fontSize: "13.5px",
                  fontWeight: 500,
                  color: "#f4f1ea",
                  border: "1px solid #333",
                  borderRadius: "8px",
                  padding: "10px 12px",
                  textDecoration: "none",
                  boxSizing: "border-box",
                  whiteSpace: "nowrap",
                }}
              >
                Write Review
              </Link>
              <div style={{ flex: "1 1 0", minWidth: 0 }}>
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

            {/* --- Sort toggle (only if there are reviews to sort) --- */}
            {show.reviews.length > 1 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "18px",
                  marginTop: "40px",
                }}
                role="tablist"
                aria-label="Review sort"
              >
                {(["recent", "top"] as const).map((mode) => {
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
                        color: active ? "#f4f1ea" : "#666",
                        fontWeight: active ? 600 : 400,
                      }}
                    >
                      {mode === "recent" ? "Recent" : "Top"}
                    </button>
                  );
                })}
              </div>
            )}

            {/* --- Reviews: the primary content --- */}
            {show.reviews.length === 0 && (
              <div
                style={{
                  color: "#888",
                  fontSize: "15px",
                  padding: "24px 0",
                  lineHeight: 1.6,
                }}
              >
                No reviews of this show yet. Be the first.
              </div>
            )}

            {sortedReviews.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "58px",
                  marginTop: show.reviews.length > 1 ? "34px" : "44px",
                }}
              >
                {sortedReviews.map((review) => (
                  <ReviewItem
                    key={review.id}
                    review={review}
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

            {/* --- Rating breakdown: available, not competing --- */}
            {show.reviewCount > 0 && (
              <div style={{ marginTop: "64px", maxWidth: "420px" }}>
                <button
                  onClick={() => setBreakdownOpen((o) => !o)}
                  aria-expanded={breakdownOpen}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "#8a8a8a",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  Rating breakdown
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    style={{
                      display: "block",
                      transform: breakdownOpen ? "rotate(90deg)" : "none",
                      transition: "transform 120ms ease",
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
                      gap: "5px",
                      marginTop: "12px",
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
                            fontSize: "12px",
                            color: "#8a8a8a",
                          }}
                        >
                          <span style={{ width: "24px", textAlign: "right" }}>
                            {stars}★
                          </span>
                          <div
                            style={{
                              flex: 1,
                              height: "6px",
                              background: "#1a1a1a",
                              borderRadius: "3px",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${pct}%`,
                                height: "100%",
                                background: "#d8d1c2",
                              }}
                            />
                          </div>
                          <span style={{ width: "20px", textAlign: "left" }}>
                            {count}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
