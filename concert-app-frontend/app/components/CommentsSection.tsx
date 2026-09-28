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
import VerifyToPublishModal from "./VerifyToPublishModal";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type CommentItem = {
  id: string;
  body: string;
  createdAt: string;
  userHandle: string;
  userName: string | null;
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
// background fill — these are commentary, not first-class content. The
// trigger is a low-emphasis text action that sits in a ReviewItem action
// row alongside the like button.
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
  const [showVerify, setShowVerify] = useState(false);
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
      if (res.status === 403 && data?.reason === "email_not_verified") {
        // Draft stays in `composer` — show the verify nudge and let them
        // retry once verified without retyping.
        setShowVerify(true);
        return;
      }
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

  const composerEmpty = composer.trim().length === 0;

  return (
    <div>
      <VerifyToPublishModal
        open={showVerify}
        kind="comment"
        onClose={() => setShowVerify(false)}
        onRetry={() => submit()}
        retrying={submitting}
      />
      <button
        onClick={toggle}
        aria-expanded={open}
        className="text-action"
        // This inline-flex button sits inside a block wrapper that
        // inherits the body line-height, so baseline alignment would drop
        // it below the sibling like button (a direct flex child that never
        // enters a line box). Align to the top so the two icons line up.
        style={{ verticalAlign: "top", lineHeight: 1 }}
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ display: "block" }}
        >
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        <span>
          {open
            ? "Hide"
            : count === 0
              ? "Add a comment"
              : `${count} ${count === 1 ? "comment" : "comments"}`}
        </span>
      </button>

      {open && (
        <div style={{ marginTop: "12px" }}>
          {loading && !loaded && (
            <div className="meta" style={{ padding: "4px 0 10px" }}>
              Loading…
            </div>
          )}

          {loaded && items.length === 0 && (
            <div className="meta" style={{ padding: "4px 0 10px" }}>
              No comments yet.
            </div>
          )}

          {items.map((c, i) => {
            const deleted = isDeletedHandle(c.userHandle);
            const owned = viewerHandle === c.userHandle && !deleted;
            return (
              <div
                key={c.id}
                style={{
                  padding: "12px 0",
                  borderTop: i === 0 ? "none" : "1px solid var(--line-soft)",
                  fontSize: "14.5px",
                  lineHeight: 1.5,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "4px 10px",
                    marginBottom: "4px",
                    minHeight: "32px",
                  }}
                >
                  {deleted ? (
                    <span style={{ fontSize: "14px", color: "var(--muted)" }}>
                      {DELETED_USER_LABEL}
                    </span>
                  ) : (
                    <Link
                      href={`/user/${c.userHandle}`}
                      className="link-quiet"
                      style={{
                        fontSize: "14px",
                        fontWeight: 600,
                        color: "var(--ink)",
                      }}
                    >
                      @{c.userHandle}
                    </Link>
                  )}
                  <span className="meta" style={{ fontSize: "13px" }}>
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
                      className="text-action"
                      style={{ marginLeft: "auto" }}
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
                      <span className="meta" style={{ fontSize: "13px" }}>
                        Delete this comment?
                      </span>
                      <button
                        onClick={async () => {
                          await remove(c.id);
                          setPendingDeleteId(null);
                        }}
                        className="btn btn-danger btn-sm"
                        style={{ height: "32px" }}
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setPendingDeleteId(null)}
                        className="btn btn-secondary btn-sm"
                        style={{ height: "32px" }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
                <div style={{ color: "var(--ink)", whiteSpace: "pre-wrap" }}>
                  {c.body}
                </div>
              </div>
            );
          })}

          {nextCursor && (
            <button
              onClick={loadMore}
              disabled={loading}
              className="btn btn-secondary btn-sm"
              style={{ marginTop: "8px" }}
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
              className="input"
              style={{ minHeight: "84px", fontSize: "15px" }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: "10px",
              }}
            >
              <span className="meta" style={{ fontSize: "12.5px" }}>
                {composer.length}/2000
              </span>
              <button
                onClick={submit}
                disabled={submitting || composerEmpty}
                className="btn btn-primary btn-sm"
              >
                {authUser ? (submitting ? "Posting…" : "Post") : "Sign in"}
              </button>
            </div>
          </div>

          {error && (
            <div
              className="notice notice-error"
              style={{ marginTop: "10px", fontSize: "13.5px" }}
            >
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
