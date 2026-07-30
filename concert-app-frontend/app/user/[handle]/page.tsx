"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { authHeaders, getToken, useAuthUser } from "../../lib/auth";
import Masthead from "../../components/Masthead";
import FollowButton from "../../components/FollowButton";
import Avatar from "../../components/Avatar";
import CommentsSection from "../../components/CommentsSection";
import ReportMenu from "../../components/ReportMenu";
import ReviewItem, {
  type ReviewItemData,
} from "../../components/ReviewItem";
import AttendedItem from "../../components/AttendedItem";
import LoadMore from "../../components/LoadMore";
import PageGlow from "../../components/PageGlow";
import ReviewSurface from "../../components/ReviewSurface";
import { formatShowDate } from "../../lib/dateFormat";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

const CREAM = "#f4f1ea";

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
  avatarUrl: string | null;
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

        {loading && !user && (
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

        {user && (
          <>
            {/* --- Identity header --- */}
            <div
              style={{
                marginTop: "20px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "16px",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <Avatar
                  handle={user.handle}
                  name={user.name}
                  avatarUrl={user.avatarUrl}
                  size={64}
                />
                <h1
                  style={{
                    margin: "14px 0 0",
                    fontSize: "26px",
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    lineHeight: 1.1,
                  }}
                >
                  {user.name || `@${user.handle}`}
                </h1>
                {user.name && (
                  <div
                    style={{
                      fontSize: "14px",
                      color: "#6f6f6f",
                      marginTop: "3px",
                    }}
                  >
                    @{user.handle}
                  </div>
                )}
                <div
                  style={{
                    fontSize: "13px",
                    color: "#6f6f6f",
                    marginTop: "10px",
                  }}
                >
                  Joined{" "}
                  {new Date(user.joinedAt).toLocaleDateString(undefined, {
                    month: "long",
                    year: "numeric",
                  })}
                </div>
                <div
                  style={{
                    fontSize: "15px",
                    color: "#d8d1c2",
                    marginTop: "16px",
                  }}
                >
                  {user.attendedShowCount}{" "}
                  {user.attendedShowCount === 1 ? "concert" : "concerts"}{" "}
                  attended
                  <span style={{ color: "#4a4a4a", margin: "0 7px" }}>•</span>
                  {user.reviewCount}{" "}
                  {user.reviewCount === 1 ? "review" : "reviews"}
                </div>
                {/* Deliberately quieter than the concert metrics. */}
                <div
                  style={{
                    fontSize: "12.5px",
                    color: "#6f6f6f",
                    marginTop: "7px",
                  }}
                >
                  Followers {user.followerCount}
                  <span style={{ color: "#3f3f3f", margin: "0 6px" }}>•</span>
                  Following {user.followingCount}
                </div>
              </div>

              {!isOwnProfile && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
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
            </div>

            {/* Identity -> history transition. */}
            <div
              style={{ borderTop: "1px solid #1c1c1c", marginTop: "34px" }}
            />

            {/* --- Unified concert history --- */}
            {history.length === 0 && !loading && (
              <div
                style={{
                  color: "#888",
                  fontSize: "15px",
                  padding: "28px 0",
                  lineHeight: 1.6,
                }}
              >
                {isOwnProfile ? (
                  <>
                    No concerts yet. Mark a show as attended or{" "}
                    <Link
                      href="/review/new"
                      style={{
                        color: CREAM,
                        textDecoration: "underline",
                        textUnderlineOffset: "3px",
                      }}
                    >
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
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "15px",
                  marginTop: "20px",
                }}
              >
                {history.map((item, i) => {
                  const artistHeading = (
                    <h2
                      style={{
                        margin: 0,
                        fontSize: "24px",
                        fontWeight: 700,
                        letterSpacing: "-0.02em",
                        lineHeight: 1.1,
                      }}
                    >
                      <Link
                        href={`/artist/${item.show.artist.id}`}
                        style={{ color: CREAM, textDecoration: "none" }}
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
                      <ReviewSurface key={`r:${review.id}`} tintIndex={i}>
                        {artistHeading}
                        <div style={{ marginTop: "12px" }}>
                          <div style={{ display: "flex", gap: "6px" }}>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                onClick={() => setEditRating(n)}
                                aria-label={`${n} star${n === 1 ? "" : "s"}`}
                                style={{
                                  background: "none",
                                  border: "none",
                                  cursor: "pointer",
                                  padding: 0,
                                  fontSize: "24px",
                                  color: n <= editRating ? CREAM : "#333",
                                  lineHeight: 1,
                                }}
                              >
                                ★
                              </button>
                            ))}
                          </div>
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            rows={4}
                            style={{
                              width: "100%",
                              marginTop: "12px",
                              padding: "12px",
                              borderRadius: "10px",
                              background: "#141414",
                              color: CREAM,
                              border: "1px solid #2a2a2a",
                              resize: "vertical",
                              fontFamily: "inherit",
                              fontSize: "15px",
                              boxSizing: "border-box",
                            }}
                          />
                          {editError && (
                            <div
                              style={{
                                color: "#ff8080",
                                fontSize: "13px",
                                marginTop: "8px",
                              }}
                            >
                              {editError}
                            </div>
                          )}
                          <div
                            style={{
                              display: "flex",
                              gap: "10px",
                              marginTop: "12px",
                            }}
                          >
                            <button
                              onClick={() => saveEdit(review.id)}
                              disabled={editSubmitting}
                              style={{
                                background: editSubmitting ? "#555" : CREAM,
                                color: editSubmitting ? "#aaa" : "#0a0a0a",
                                border: "none",
                                borderRadius: "8px",
                                padding: "8px 16px",
                                fontWeight: 600,
                                fontSize: "13.5px",
                                cursor: editSubmitting
                                  ? "not-allowed"
                                  : "pointer",
                                fontFamily: "inherit",
                              }}
                            >
                              {editSubmitting ? "Saving…" : "Save"}
                            </button>
                            <button
                              onClick={cancelEdit}
                              style={{
                                background: "none",
                                color: "#aaa",
                                border: "1px solid #333",
                                borderRadius: "8px",
                                padding: "8px 16px",
                                fontSize: "13.5px",
                                cursor: "pointer",
                                fontFamily: "inherit",
                              }}
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
                    userAvatarUrl: user.avatarUrl,
                    ratingOverall: review.ratingOverall,
                    reviewTextRaw: review.reviewTextRaw,
                    likeCount: review.likeCount,
                    commentCount: review.commentCount,
                    liked: review.liked,
                  };

                  return (
                    <ReviewSurface key={`r:${review.id}`} tintIndex={i}>
                    <ReviewItem
                      review={reviewData}
                      heading={artistHeading}
                      // The header already establishes whose reviews these are.
                      hideByline
                      context={
                        <Link
                          href={`/show/${item.show.id}`}
                          style={{
                            display: "inline-block",
                            textDecoration: "none",
                          }}
                        >
                          <div
                            style={{ fontSize: "14px", color: "#8a8a8a" }}
                          >
                            {item.show.venue.name}
                          </div>
                          <div
                            style={{
                              fontSize: "13.5px",
                              color: "#6f6f6f",
                              marginTop: "1px",
                            }}
                          >
                            {formatShowDate(item.show.localDate, { longMonth: true })}
                          </div>
                        </Link>
                      }
                      actions={
                        <>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <CommentsSection
                              reviewId={review.id}
                              initialCount={review.commentCount}
                              variant="editorial"
                            />
                          </div>
                          {isOwnProfile && (
                            <span
                              style={{
                                display: "flex",
                                gap: "14px",
                                flexShrink: 0,
                              }}
                            >
                              <button
                                onClick={() => startEdit(item)}
                                style={{
                                  background: "none",
                                  border: "none",
                                  padding: 0,
                                  color: "#6a6a6a",
                                  fontSize: "13px",
                                  cursor: "pointer",
                                  fontFamily: "inherit",
                                }}
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => deleteReview(review.id)}
                                style={{
                                  background: "none",
                                  border: "none",
                                  padding: 0,
                                  color: "#6a6a6a",
                                  fontSize: "13px",
                                  cursor: "pointer",
                                  fontFamily: "inherit",
                                }}
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
              <div style={{ marginTop: "48px" }}>
                <LoadMore
                  onClick={loadMoreHistory}
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
