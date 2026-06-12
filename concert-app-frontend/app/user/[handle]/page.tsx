"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { authHeaders, getToken, useAuthUser } from "../../lib/auth";
import LikeButton from "../../components/LikeButton";
import StarRating from "../../components/StarRating";
import FollowButton from "../../components/FollowButton";
import Avatar from "../../components/Avatar";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type Review = {
  id: string;
  ratingOverall: number;
  reviewTextRaw: string;
  publishedAt: string | null;
  likeCount: number;
  liked: boolean;
  show: {
    id: string;
    localDate: string;
    artist: { id: string; name: string };
    venue: { name: string; city: string };
  };
};

type UserDetail = {
  handle: string;
  name: string | null;
  avatarUrl: string | null;
  joinedAt: string;
  attendedShowCount: number;
  artistsSeenCount: number;
  venuesVisitedCount: number;
  reviewCount: number;
  averageRating: number;
  followerCount: number;
  followingCount: number;
  followedByMe: boolean;
  reviews: Review[];
};

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
    } catch {
      setError("Couldn't load this profile. Try refreshing.");
    }
  }, [handle]);

  // Initial load — separate inline async to keep setState calls out of
  // the useEffect body (so the react-hooks/set-state-in-effect rule passes).
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
        if (!cancelled) setUser(data);
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

  function startEdit(review: Review) {
    setEditingId(review.id);
    setEditRating(review.ratingOverall);
    setEditText(review.reviewTextRaw);
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
      // Refetch so the rating and avg stay consistent with the server
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
      // Clear edit state in case the deleted review was being edited
      if (editingId === reviewId) setEditingId(null);
      refetchSilent();
    } catch {
      alert("Network error. Try again.");
    }
  }

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

        {user && (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "16px",
                marginBottom: "10px",
              }}
            >
              <Avatar
                handle={user.handle}
                name={user.name}
                avatarUrl={user.avatarUrl}
                size={72}
              />
              <div style={{ minWidth: 0 }}>
                {user.name ? (
                  <>
                    <h1
                      style={{
                        fontSize: "28px",
                        margin: "0 0 2px",
                        lineHeight: 1.1,
                        fontFamily: "var(--font-display), sans-serif",
                        fontWeight: 700,
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {user.name}
                    </h1>
                    <div style={{ color: "#888", fontSize: "14px" }}>
                      @{user.handle}
                    </div>
                  </>
                ) : (
                  <h1
                    style={{
                      fontSize: "28px",
                      margin: 0,
                      lineHeight: 1.1,
                      fontFamily: "var(--font-display), sans-serif",
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    @{user.handle}
                  </h1>
                )}
              </div>
            </div>
            <div style={{ color: "#888", fontSize: "13px", marginBottom: "10px" }}>
              Joined{" "}
              {new Date(user.joinedAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
              })}
            </div>
            {/* Attendance-derived primary stats: shows attended, distinct
                artists, distinct venues. Reviews + avg rating sit on a
                secondary line below. */}
            <div style={{ color: "#aaa", marginBottom: "6px" }}>
              {user.attendedShowCount === 0 ? (
                "No shows attended yet"
              ) : (
                <>
                  <strong style={{ color: "#f4f1ea" }}>
                    {user.attendedShowCount}
                  </strong>{" "}
                  {user.attendedShowCount === 1 ? "show" : "shows"} attended
                  <span style={{ color: "#444", margin: "0 8px" }}>·</span>
                  <strong style={{ color: "#f4f1ea" }}>
                    {user.artistsSeenCount}
                  </strong>{" "}
                  {user.artistsSeenCount === 1 ? "artist" : "artists"} seen
                  <span style={{ color: "#444", margin: "0 8px" }}>·</span>
                  <strong style={{ color: "#f4f1ea" }}>
                    {user.venuesVisitedCount}
                  </strong>{" "}
                  {user.venuesVisitedCount === 1 ? "venue" : "venues"}{" "}
                  visited
                </>
              )}
            </div>
            <div style={{ color: "#aaa", marginBottom: "10px" }}>
              <strong style={{ color: "#f4f1ea" }}>
                {user.reviewCount}
              </strong>{" "}
              {user.reviewCount === 1 ? "review" : "reviews"} written
              {user.reviewCount > 0 && (
                <>
                  <span style={{ color: "#444", margin: "0 8px" }}>·</span>
                  {user.averageRating} ★ avg
                </>
              )}
            </div>
            <div
              style={{
                color: "#aaa",
                fontSize: "14px",
                marginBottom: isOwnProfile ? "28px" : "16px",
              }}
            >
              <strong style={{ color: "#f4f1ea" }}>{user.followerCount}</strong>{" "}
              {user.followerCount === 1 ? "follower" : "followers"}
              <span style={{ color: "#444", margin: "0 8px" }}>·</span>
              <strong style={{ color: "#f4f1ea" }}>{user.followingCount}</strong>{" "}
              following
            </div>
            {!isOwnProfile && (
              <div style={{ marginBottom: "28px" }}>
                <FollowButton
                  handle={user.handle}
                  initialFollowing={user.followedByMe}
                  initialFollowerCount={user.followerCount}
                  onChange={({ following, followerCount }) => {
                    setUser((prev) =>
                      prev
                        ? {
                            ...prev,
                            followedByMe: following,
                            followerCount,
                          }
                        : prev,
                    );
                  }}
                />
              </div>
            )}

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

            {user.reviews.map((review) => {
              const isEditing = editingId === review.id;
              return (
                <div
                  key={review.id}
                  style={{
                    padding: "28px 0",
                    borderBottom: "1px solid #1f1f1f",
                    position: "relative",
                  }}
                >
                  {/* Overlay link to the show — suppressed while editing
                      so a stray click can't navigate away from the form. */}
                  {!isEditing && (
                    <Link
                      href={`/show/${review.show.id}`}
                      aria-label={`View show: ${review.show.artist.name} at ${review.show.venue.name}`}
                      style={{
                        position: "absolute",
                        inset: 0,
                        zIndex: 0,
                      }}
                    />
                  )}
                  <div
                    style={{
                      position: "relative",
                      zIndex: 1,
                      pointerEvents: isEditing ? "auto" : "none",
                    }}
                  >
                    <div style={{ fontSize: "15px" }}>
                      <Link
                        href={`/user/${user.handle}`}
                        style={{
                          color: "#f4f1ea",
                          textDecoration: "underline",
                          textUnderlineOffset: "3px",
                          fontWeight: "bold",
                          pointerEvents: "auto",
                          position: "relative",
                        }}
                      >
                        @{user.handle}
                      </Link>
                      <span style={{ color: "#aaa" }}> reviewed </span>
                      <span style={{ color: "#f4f1ea", fontWeight: "bold" }}>
                        {review.show.artist.name}
                      </span>
                    </div>
                    <div
                      style={{
                        color: "#aaa",
                        fontSize: "14px",
                        marginTop: "4px",
                      }}
                    >
                      {review.show.venue.name}
                      <span style={{ color: "#555", margin: "0 6px" }}>·</span>
                      {review.show.venue.city}
                    </div>
                    {!isEditing && (
                      <div style={{ marginTop: "8px" }}>
                        <StarRating rating={review.ratingOverall} />
                      </div>
                    )}

                  {isEditing ? (
                    <div style={{ marginTop: "12px" }}>
                      <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
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
                              fontSize: "26px",
                              color: n <= editRating ? "#fbbf24" : "#444",
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
                          padding: "10px",
                          borderRadius: "10px",
                          background: "#111",
                          color: "#f4f1ea",
                          border: "1px solid #333",
                          resize: "vertical",
                          fontFamily: "inherit",
                          fontSize: "14px",
                          boxSizing: "border-box",
                          marginBottom: "10px",
                        }}
                      />
                      {editError && (
                        <div style={{ color: "#ff8080", fontSize: "13px", marginBottom: "10px" }}>
                          {editError}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          onClick={() => saveEdit(review.id)}
                          disabled={editSubmitting}
                          style={{
                            padding: "8px 14px",
                            borderRadius: "10px",
                            border: "none",
                            background: editSubmitting ? "#555" : "#f4f1ea",
                            color: editSubmitting ? "#aaa" : "#0a0a0a",
                            cursor: editSubmitting ? "not-allowed" : "pointer",
                            fontWeight: "bold",
                            fontSize: "14px",
                          }}
                        >
                          {editSubmitting ? "Saving…" : "Save"}
                        </button>
                        <button
                          onClick={cancelEdit}
                          disabled={editSubmitting}
                          style={{
                            padding: "8px 14px",
                            borderRadius: "10px",
                            border: "1px solid #333",
                            background: "transparent",
                            color: "#aaa",
                            cursor: editSubmitting ? "not-allowed" : "pointer",
                            fontSize: "14px",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ marginTop: "10px" }}>{review.reviewTextRaw}</div>
                      <div
                        style={{
                          marginTop: "12px",
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          fontSize: "13px",
                          pointerEvents: "auto",
                          position: "relative",
                        }}
                      >
                        <LikeButton
                          reviewId={review.id}
                          initialLiked={review.liked}
                          initialLikeCount={review.likeCount}
                        />
                        {isOwnProfile && (
                          <>
                            <span style={{ color: "#444" }}>·</span>
                            <button
                              onClick={() => startEdit(review)}
                              style={{
                                background: "none",
                                border: "none",
                                padding: 0,
                                color: "#f4f1ea",
                                cursor: "pointer",
                                fontSize: "13px",
                                fontFamily: "inherit",
                                textDecoration: "underline",
                                textUnderlineOffset: "3px",
                              }}
                            >
                              Edit
                            </button>
                            <span style={{ color: "#444" }}>·</span>
                            <button
                              onClick={() => deleteReview(review.id)}
                              style={{
                                background: "none",
                                border: "none",
                                padding: 0,
                                color: "#ff8080",
                                cursor: "pointer",
                                fontSize: "13px",
                              }}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </main>
  );
}
