"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { authHeaders, getToken, useAuthUser } from "../../lib/auth";
import FollowButton from "../../components/FollowButton";
import Avatar from "../../components/Avatar";
import CommentsSection from "../../components/CommentsSection";
import ReportMenu from "../../components/ReportMenu";
import ReviewItem, {
  type ReviewItemData,
} from "../../components/ReviewItem";
import AttendedItem from "../../components/AttendedItem";
import LoadMore from "../../components/LoadMore";
import ReviewSurface from "../../components/ReviewSurface";
import { STAR_PATH } from "../../components/StarRating";
import { formatShowDate } from "../../lib/dateFormat";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type HistoryShow = {
  id: string;
  localDate: string;
  artist: { id: string; name: string };
  venue: { name: string; city: string };
};

type HistoryItem = {
  kind: "review" | "attended";
  show: HistoryShow;
  review: {
    id: string;
    ratingOverall: number;
    reviewTextRaw: string;
    publishedAt: string | null;
    likeCount: number;
    commentCount: number;
    liked: boolean;
  } | null;
};

type UserDetail = {
  id: string;
  handle: string;
  name: string | null;
  joinedAt: string;
  attendedShowCount: number;
  reviewCount: number;
  followerCount: number;
  followingCount: number;
  followedByMe: boolean;
  // Unified concert history. Optional so the frontend degrades gracefully
  // in the window where it deploys ahead of the backend.
  history?: HistoryItem[];
  historyNextCursor?: string | null;
};

const PAGE_SIZE = 20;

/** Stable identity for a history entry — one row per show. */
function historyKey(item: HistoryItem): string {
  return item.show.id;
}

export default function UserPage() {
  const params = useParams<{ handle: string }>();
  const handle = params?.handle;

  const authUser = useAuthUser();
  const isOwnProfile = !!authUser && authUser.handle === handle;

  const [user, setUser] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Edit state — only one review can be edited at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRating, setEditRating] = useState(0);
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Pagination over the already-merged chronological history. The client
  // never paginates reviews and attendance separately — the server hands
  // back one stream and one composite cursor.
  const [extraHistory, setExtraHistory] = useState<HistoryItem[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  // Silent refetch used by event handlers (after PATCH / DELETE) — does
  // not toggle the loading spinner so the page doesn't flash.
  const refetchSilent = useCallback(async () => {
    if (!handle) return;
    try {
      const res = await fetch(`${API_BASE}/users/${handle}`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        setError(
          res.status === 404
            ? `No user @${handle}.`
            : "Couldn't load this profile. Try refreshing.",
        );
        return;
      }
      const data: UserDetail = await res.json();
      setUser(data);
      setExtraHistory([]);
      setHistoryCursor(data.historyNextCursor ?? null);
    } catch {
      setError("Couldn't load this profile. Try refreshing.");
    }
  }, [handle]);

  useEffect(() => {
    if (!handle) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/users/${handle}`, {
          headers: authHeaders(),
        });
        if (!res.ok) {
          if (!cancelled)
            setError(
              res.status === 404
                ? `No user @${handle}.`
                : "Couldn't load this profile. Try refreshing.",
            );
          return;
        }
        const data: UserDetail = await res.json();
        if (!cancelled) {
          setUser(data);
          setExtraHistory([]);
          setHistoryCursor(data.historyNextCursor ?? null);
        }
      } catch {
        if (!cancelled)
          setError("Couldn't load this profile. Try refreshing.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [handle]);

  function startEdit(item: HistoryItem) {
    if (!item.review) return;
    setEditingId(item.review.id);
    setEditRating(item.review.ratingOverall);
    setEditText(item.review.reviewTextRaw);
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function saveEdit(reviewId: string) {
    if (editRating < 1 || editRating > 5) {
      setEditError("Pick a rating from 1 to 5 stars.");
      return;
    }
    if (!editText.trim()) {
      setEditError("Review text can't be empty.");
      return;
    }

    const token = getToken();
    if (!token) {
      setEditError("Not signed in.");
      return;
    }

    setEditSubmitting(true);
    setEditError(null);
    try {
      const res = await fetch(`${API_BASE}/reviews/${reviewId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ratingOverall: editRating,
          reviewTextRaw: editText.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setEditError(data?.error || `Edit failed (HTTP ${res.status}).`);
        setEditSubmitting(false);
        return;
      }

      setEditingId(null);
      setEditSubmitting(false);
      refetchSilent();
    } catch {
      setEditError("Network error. Try again.");
      setEditSubmitting(false);
    }
  }

  async function deleteReview(reviewId: string) {
    const ok = window.confirm("Delete this review? This can't be undone.");
    if (!ok) return;

    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/reviews/${reviewId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}));
        alert(data?.error || `Delete failed (HTTP ${res.status}).`);
        return;
      }
      if (editingId === reviewId) setEditingId(null);
      refetchSilent();
    } catch {
      alert("Network error. Try again.");
    }
  }

  async function loadMoreHistory() {
    if (!handle || !historyCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const res = await fetch(
        `${API_BASE}/users/${handle}?historyLimit=${PAGE_SIZE}&historyCursor=${encodeURIComponent(historyCursor)}`,
        { headers: authHeaders() },
      );
      if (!res.ok) {
        setMoreError("Couldn't load more.");
        return;
      }
      const data: UserDetail = await res.json();
      setExtraHistory((prev) => {
        const seen = new Set(
          [...(user?.history ?? []), ...prev].map(historyKey),
        );
        const fresh = (data.history ?? []).filter(
          (h) => !seen.has(historyKey(h)),
        );
        return [...prev, ...fresh];
      });
      setHistoryCursor(data.historyNextCursor ?? null);
    } catch {
      setMoreError("Couldn't load more.");
    } finally {
      setLoadingMore(false);
    }
  }

  const history = [...(user?.history ?? []), ...extraHistory];

  const joinedLabel = user
    ? new Date(user.joinedAt).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      })
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
          Back
        </Link>

        {loading && !user && (
          <div aria-busy="true" style={{ padding: "24px 0 48px" }}>
            <span className="sr-only">Loading…</span>
            <div className="skeleton" style={{ width: "72px", height: "72px", borderRadius: "50%" }} />
            <div className="skeleton" style={{ width: "55%", height: "56px", marginTop: "20px" }} />
            <div className="skeleton" style={{ width: "30%", height: "18px", marginTop: "16px" }} />
          </div>
        )}

        {!loading && error && (
          <div className="notice notice-error" style={{ margin: "16px 0 48px" }}>
            {error}
          </div>
        )}

        {user && (
          <>
            {/* --- Identity header --- */}
            <header
              style={{
                paddingTop: "16px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                flexWrap: "wrap",
                gap: "20px",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <Avatar handle={user.handle} name={user.name} size={72} />
                <h1
                  style={{
                    margin: "20px 0 0",
                    fontSize: "clamp(40px, 6.4vw, 72px)",
                    lineHeight: 0.98,
                    fontWeight: 700,
                    letterSpacing: "-0.05em",
                    overflowWrap: "anywhere",
                  }}
                >
                  {user.name || `@${user.handle}`}
                </h1>
                <div
                  style={{
                    marginTop: "12px",
                    fontSize: "clamp(17px, 1.8vw, 20px)",
                    fontWeight: 500,
                    letterSpacing: "-0.012em",
                  }}
                >
                  {user.name && <>@{user.handle}</>}
                  <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                    {user.name ? " · " : ""}
                    Joined {joinedLabel}
                  </span>
                </div>
              </div>

              {!isOwnProfile && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    flexShrink: 0,
                  }}
                >
                  <FollowButton
                    handle={user.handle}
                    initialFollowing={user.followedByMe}
                    initialFollowerCount={user.followerCount}
                    onChange={({ following, followerCount }) => {
                      setUser((prev) =>
                        prev
                          ? { ...prev, followedByMe: following, followerCount }
                          : prev,
                      );
                    }}
                  />
                  {authUser && (
                    <ReportMenu targetType="USER" targetId={user.id} />
                  )}
                </div>
              )}
            </header>

            {/* --- Stats: concert metrics lead --- */}
            <dl
              style={{
                margin: "28px 0 0",
                padding: "18px 0",
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                borderTop: "1px solid var(--line)",
                borderBottom: "1px solid var(--line)",
                maxWidth: "360px",
              }}
            >
              {[
                {
                  label:
                    user.attendedShowCount === 1
                      ? "Concert attended"
                      : "Concerts attended",
                  value: user.attendedShowCount,
                },
                {
                  label: user.reviewCount === 1 ? "Review" : "Reviews",
                  value: user.reviewCount,
                },
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
                      fontSize: "28px",
                      fontWeight: 700,
                      letterSpacing: "-0.04em",
                      lineHeight: 1,
                    }}
                  >
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>

            {/* Deliberately quieter than the concert metrics. */}
            <div className="meta" style={{ margin: "14px 0 40px" }}>
              Followers {user.followerCount}
              <span aria-hidden="true" style={{ margin: "0 7px" }}>·</span>
              Following {user.followingCount}
            </div>
          </>
        )}
      </div>

      {user && (
        <section className="band">
          <div
            className="container-md"
            style={{
              paddingTop: "clamp(28px, 4vw, 48px)",
              paddingBottom: "clamp(40px, 6vw, 80px)",
            }}
          >
            {/* --- Unified concert history --- */}
            {history.length === 0 && !loading && (
              <div
                className="card"
                style={{
                  textAlign: "center",
                  padding: "48px 24px",
                  fontSize: "17px",
                  lineHeight: 1.5,
                  color: "var(--ink-2)",
                }}
              >
                {isOwnProfile ? (
                  <>
                    No concerts yet. Mark a show as attended or{" "}
                    <Link href="/review/new" className="link">
                      write a review
                    </Link>{" "}
                    to start your history.
                  </>
                ) : (
                  <>No concerts in @{user.handle}&rsquo;s history yet.</>
                )}
              </div>
            )}

            {history.length > 0 && (
              <div className="stack" style={{ gap: "14px" }}>
                {history.map((item) => {
                  const artistHeading = (
                    <h2
                      style={{
                        margin: 0,
                        fontSize: "clamp(22px, 2.4vw, 26px)",
                        fontWeight: 700,
                        letterSpacing: "-0.035em",
                        lineHeight: 1.1,
                      }}
                    >
                      <Link
                        href={`/artist/${item.show.artist.id}`}
                        className="link-quiet"
                      >
                        {item.show.artist.name}
                      </Link>
                    </h2>
                  );

                  // Attended-but-not-reviewed stays QUIET: outline only, no
                  // fill. A profile is mostly attendance, so giving these
                  // the filled card would flatten the deliberate hierarchy
                  // of reviews loud / bare attendance secondary.
                  if (item.kind === "attended" || !item.review) {
                    return (
                      <ReviewSurface key={`a:${item.show.id}`} variant="quiet">
                        <AttendedItem
                          show={item.show}
                          isOwner={isOwnProfile}
                        />
                      </ReviewSurface>
                    );
                  }

                  const review = item.review;
                  const isEditing = editingId === review.id;

                  // Editing replaces the review body with the form so a
                  // stray click can't navigate away mid-edit.
                  if (isEditing) {
                    return (
                      <ReviewSurface key={`r:${review.id}`}>
                        {artistHeading}
                        <div style={{ marginTop: "14px" }}>
                          <div style={{ display: "flex", gap: "2px" }}>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                onClick={() => setEditRating(n)}
                                aria-label={`${n} star${n === 1 ? "" : "s"}`}
                                style={{
                                  width: "40px",
                                  height: "40px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  background: "none",
                                  border: "none",
                                  borderRadius: "var(--radius-sm)",
                                  cursor: "pointer",
                                  padding: 0,
                                }}
                              >
                                <svg
                                  width="28"
                                  height="28"
                                  viewBox="0 0 24 24"
                                  aria-hidden="true"
                                  style={{ display: "block" }}
                                >
                                  <path
                                    d={STAR_PATH}
                                    fill={
                                      n <= editRating
                                        ? "var(--ink)"
                                        : "var(--disabled)"
                                    }
                                  />
                                </svg>
                              </button>
                            ))}
                          </div>
                          <textarea
                            className="input"
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            rows={4}
                            aria-label="Review text"
                            style={{ marginTop: "12px" }}
                          />
                          {editError && (
                            <div
                              className="notice notice-error"
                              style={{ marginTop: "10px" }}
                            >
                              {editError}
                            </div>
                          )}
                          <div
                            style={{
                              display: "flex",
                              gap: "10px",
                              marginTop: "14px",
                            }}
                          >
                            <button
                              onClick={() => saveEdit(review.id)}
                              disabled={editSubmitting}
                              className="btn btn-primary"
                            >
                              {editSubmitting ? "Saving…" : "Save"}
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="btn btn-secondary"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </ReviewSurface>
                    );
                  }

                  const reviewData: ReviewItemData = {
                    id: review.id,
                    userHandle: user.handle,
                    userName: user.name,
                    ratingOverall: review.ratingOverall,
                    reviewTextRaw: review.reviewTextRaw,
                    likeCount: review.likeCount,
                    commentCount: review.commentCount,
                    liked: review.liked,
                  };

                  return (
                    <ReviewSurface key={`r:${review.id}`}>
                      <ReviewItem
                        review={reviewData}
                        heading={artistHeading}
                        // The header already establishes whose reviews these are.
                        hideByline
                        context={
                          <Link
                            href={`/show/${item.show.id}`}
                            className="link-quiet"
                            style={{ display: "inline-block" }}
                          >
                            <div
                              style={{
                                fontSize: "15px",
                                fontWeight: 500,
                                color: "var(--ink-2)",
                              }}
                            >
                              {item.show.venue.name}
                            </div>
                            <div className="meta" style={{ marginTop: "2px" }}>
                              {formatShowDate(item.show.localDate, {
                                longMonth: true,
                              })}
                            </div>
                          </Link>
                        }
                        actions={
                          <>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <CommentsSection
                                reviewId={review.id}
                                initialCount={review.commentCount}
                              />
                            </div>
                            {isOwnProfile && (
                              <span
                                style={{
                                  display: "flex",
                                  gap: "16px",
                                  flexShrink: 0,
                                }}
                              >
                                <button
                                  onClick={() => startEdit(item)}
                                  className="text-action"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => deleteReview(review.id)}
                                  className="text-action"
                                >
                                  Delete
                                </button>
                              </span>
                            )}
                          </>
                        }
                      />
                    </ReviewSurface>
                  );
                })}
              </div>
            )}

            {historyCursor && (
              <div style={{ marginTop: "32px" }}>
                <LoadMore
                  onClick={loadMoreHistory}
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
