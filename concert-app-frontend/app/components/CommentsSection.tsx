"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import {
  authHeaders,
  getToken,
  getUser,
  useAuthUser,
} from "../lib/auth";
import { isDeletedHandle, DELETED_USER_LABEL } from "../lib/displayUser";
import ReportMenu from "./ReportMenu";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type CommentItem = {
  id: string;
  body: string;
  createdAt: string;
  userHandle: string;
  userName: string | null;
  userAvatarUrl: string | null;
};

type Props = {
  reviewId: string;
  initialCount: number;
};

// Flat comments under a single review. Collapsed by default to keep
// review-list pages scannable; the toggle reveals an oldest-first
// paginated list plus a composer for signed-in users.
//
// Visually lighter than reviews: smaller font, no stars, no avatar
// background fill — these are commentary, not first-class content.
export default function CommentsSection({ reviewId, initialCount }: Props) {
  const authUser = useAuthUser();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CommentItem[]>([]);
  const [count, setCount] = useState(initialCount);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [composer, setComposer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Two-step delete confirmation: holds the comment id that is currently
  // awaiting confirmation. Clicking "Delete" sets it; clicking "Confirm"
  // performs the delete; clicking "Cancel" or hitting "Delete" on a
  // different row resets it. Only one row can be in this state at a time.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const loadInitial = useCallback(async () => {
    if (loaded || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/reviews/${encodeURIComponent(reviewId)}/comments?limit=20`,
      );
      if (!res.ok) {
        setError("Could not load comments.");
        return;
      }
      const data = await res.json();
      setItems(data.items || []);
      setNextCursor(data.nextCursor ?? null);
      setLoaded(true);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }, [reviewId, loaded, loading]);

  async function loadMore() {
    if (!nextCursor || loading) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/reviews/${encodeURIComponent(reviewId)}/comments?limit=20&cursor=${encodeURIComponent(nextCursor)}`,
      );
      if (!res.ok) {
        setError("Could not load more.");
        return;
      }
      const data = await res.json();
      setItems((prev) => [...prev, ...(data.items || [])]);
      setNextCursor(data.nextCursor ?? null);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen && !loaded) {
      await loadInitial();
    }
  }

  async function submit() {
    if (!authUser) {
      // Signed-out: redirect to sign in with a next param pointing back
      // here. The current page url is preserved.
      const next = encodeURIComponent(window.location.pathname);
      window.location.href = `/signin?next=${next}`;
      return;
    }
    const body = composer.trim();
    if (body.length === 0) return;
    if (body.length > 2000) {
      setError("Comments must be 2000 characters or fewer.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/reviews/${encodeURIComponent(reviewId)}/comments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
          },
          body: JSON.stringify({ body }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (data?.error as string | undefined) ||
            "Could not post your comment.",
        );
        return;
      }
      // Insert at the end since we sort ASC (oldest first).
      const c = data.comment as CommentItem;
      setItems((prev) => [...prev, c]);
      setCount((n) => n + 1);
      setComposer("");
    } catch {
      setError("Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(commentId: string) {
    try {
      const res = await fetch(
        `${API_BASE}/reviews/${encodeURIComponent(reviewId)}/comments/${encodeURIComponent(commentId)}`,
        {
          method: "DELETE",
          headers: { ...authHeaders() },
        },
      );
      if (res.status !== 204) {
        setError("Could not delete your comment.");
        return;
      }
      setItems((prev) => prev.filter((c) => c.id !== commentId));
      setCount((n) => Math.max(0, n - 1));
    } catch {
      setError("Network error.");
    }
  }

  const viewerHandle = authUser?.handle ?? null;

  return (
    <div style={{ marginTop: "12px" }}>
      <button
        onClick={toggle}
        style={{
          background: "transparent",
          border: "none",
          color: "#aaa",
          cursor: "pointer",
          fontSize: "13px",
          padding: "4px 0",
          textAlign: "left",
        }}
      >
        💬{" "}
        {count === 0
          ? open
            ? "Hide"
            : "Add a comment"
          : `${count} ${count === 1 ? "comment" : "comments"}`}
        {count > 0 ? (open ? " — Hide" : " — View") : ""}
      </button>

      {open && (
        <div
          style={{
            marginTop: "8px",
            paddingLeft: "12px",
            borderLeft: "2px solid #1f1f1f",
          }}
        >
          {loading && !loaded && (
            <div style={{ color: "#777", fontSize: "13px", padding: "4px 0" }}>
              Loading…
            </div>
          )}

          {loaded && items.length === 0 && (
            <div
              style={{ color: "#777", fontSize: "13px", padding: "4px 0 8px" }}
            >
              No comments yet.
            </div>
          )}

          {items.map((c) => {
            const deleted = isDeletedHandle(c.userHandle);
            const owned = viewerHandle === c.userHandle && !deleted;
            return (
              <div
                key={c.id}
                style={{
                  padding: "8px 0",
                  borderBottom: "1px solid #161616",
                  fontSize: "13px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "8px",
                    marginBottom: "4px",
                  }}
                >
                  {deleted ? (
                    <span style={{ color: "#888" }}>{DELETED_USER_LABEL}</span>
                  ) : (
                    <Link
                      href={`/user/${c.userHandle}`}
                      style={{
                        color: "#f4f1ea",
                        textDecoration: "underline",
                        textUnderlineOffset: "3px",
                        fontWeight: "bold",
                      }}
                    >
                      @{c.userHandle}
                    </Link>
                  )}
                  <span style={{ color: "#666", fontSize: "12px" }}>
                    {new Date(c.createdAt).toLocaleString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  {authUser && !owned && !deleted && (
                    <span style={{ marginLeft: "auto" }}>
                      <ReportMenu targetType="COMMENT" targetId={c.id} />
                    </span>
                  )}
                  {owned && pendingDeleteId !== c.id && (
                    <button
                      onClick={() => setPendingDeleteId(c.id)}
                      aria-label="Delete your comment"
                      style={{
                        marginLeft: "auto",
                        background: "transparent",
                        border: "none",
                        color: "#888",
                        cursor: "pointer",
                        fontSize: "12px",
                        padding: "2px 6px",
                      }}
                    >
                      Delete
                    </button>
                  )}
                  {owned && pendingDeleteId === c.id && (
                    <div
                      style={{
                        marginLeft: "auto",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <span style={{ color: "#aaa", fontSize: "12px" }}>
                        Delete this comment?
                      </span>
                      <button
                        onClick={async () => {
                          await remove(c.id);
                          setPendingDeleteId(null);
                        }}
                        style={{
                          background: "transparent",
                          border: "1px solid #ff8080",
                          color: "#ff8080",
                          padding: "2px 8px",
                          borderRadius: "999px",
                          cursor: "pointer",
                          fontSize: "12px",
                        }}
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setPendingDeleteId(null)}
                        style={{
                          background: "transparent",
                          border: "1px solid #555",
                          color: "#aaa",
                          padding: "2px 8px",
                          borderRadius: "999px",
                          cursor: "pointer",
                          fontSize: "12px",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
                <div style={{ color: "#f4f1ea", whiteSpace: "pre-wrap" }}>
                  {c.body}
                </div>
              </div>
            );
          })}

          {nextCursor && (
            <button
              onClick={loadMore}
              disabled={loading}
              style={{
                background: "transparent",
                border: "1px solid #2a2a2a",
                color: "#aaa",
                padding: "6px 12px",
                borderRadius: "999px",
                cursor: loading ? "not-allowed" : "pointer",
                fontSize: "12px",
                marginTop: "8px",
              }}
            >
              {loading ? "Loading…" : "Load more"}
            </button>
          )}

          {/* Composer */}
          <div style={{ marginTop: "12px" }}>
            <textarea
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              placeholder={
                authUser
                  ? "Add a comment…"
                  : "Sign in to comment"
              }
              maxLength={2000}
              rows={2}
              disabled={submitting}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "10px",
                border: "1px solid #2a2a2a",
                background: "#101010",
                color: "white",
                fontSize: "13px",
                resize: "vertical",
                boxSizing: "border-box",
                fontFamily: "inherit",
              }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: "6px",
              }}
            >
              <span style={{ color: "#555", fontSize: "11px" }}>
                {composer.length}/2000
              </span>
              <button
                onClick={submit}
                disabled={submitting || composer.trim().length === 0}
                style={{
                  background:
                    submitting || composer.trim().length === 0
                      ? "#333"
                      : "#f4f1ea",
                  color:
                    submitting || composer.trim().length === 0
                      ? "#888"
                      : "#0a0a0a",
                  border: "none",
                  padding: "6px 14px",
                  borderRadius: "999px",
                  cursor:
                    submitting || composer.trim().length === 0
                      ? "not-allowed"
                      : "pointer",
                  fontSize: "12px",
                  fontWeight: "bold",
                }}
              >
                {authUser ? (submitting ? "Posting…" : "Post") : "Sign in"}
              </button>
            </div>
          </div>

          {error && (
            <div
              style={{
                color: "#ff8080",
                fontSize: "12px",
                marginTop: "6px",
              }}
            >
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
