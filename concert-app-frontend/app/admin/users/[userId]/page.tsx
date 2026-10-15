"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getToken, authHeaders } from "../../../lib/auth";
import { isDeletedHandle, DELETED_USER_LABEL } from "../../../lib/displayUser";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

/**
 * Admin user detail.
 *
 * WHY THIS PAGE EXISTS: the moderation queue only lists reports with
 * status OPEN. Blocking a review or suspending a user resolves its
 * reports to ACTIONED, so the item leaves the queue — taking the
 * Restore / Unsuspend buttons with it. The endpoints still worked;
 * there was simply nowhere left in the product to press them, which
 * made every moderation decision one-way.
 *
 * This page is that missing surface, and it is reachable by user id
 * forever rather than only while a report happens to be open. It adds
 * no API: GET /admin/users/:userId already returns the suspension
 * state and ALL of a user's reviews including BLOCKED ones.
 */

type AdminReview = {
  id: string;
  reviewTextRaw: string;
  ratingOverall: number;
  moderationStatus: "PENDING" | "ALLOWED" | "WARNED" | "BLOCKED";
  createdAt: string;
  showId: string;
};

type AdminUser = {
  id: string;
  handle: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
  suspendedAt: string | null;
  suspensionReason: string | null;
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString();
}

export default function AdminUserDetailPage() {
  const router = useRouter();
  const params = useParams();
  const userId = typeof params?.userId === "string" ? params.userId : "";

  const [user, setUser] = useState<AdminUser | null>(null);
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [openReportCount, setOpenReportCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!getToken()) {
      router.replace(`/signin?next=/admin/users/${userId}`);
      return;
    }
    const res = await fetch(`${API_BASE}/admin/users/${userId}`, {
      headers: authHeaders(),
    });
    if (res.status === 401) {
      router.replace(`/signin?next=/admin/users/${userId}`);
      return;
    }
    if (res.status === 403) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    if (res.status === 404) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const data = await res.json();
    setUser(data.user ?? null);
    setReviews(data.reviews ?? []);
    setOpenReportCount(data.openReportCount ?? 0);
    setLoading(false);
  }, [router, userId]);

  useEffect(() => {
    if (userId) load();
  }, [load, userId]);

  async function act(path: string, body: object, key: string) {
    setBusy(key);
    try {
      await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (forbidden) {
    return (
      <Shell>
        <p style={{ margin: "16px 0 0", fontSize: "17px", color: "var(--ink-2)" }}>
          You don&rsquo;t have access to this page.
        </p>
      </Shell>
    );
  }

  if (notFound) {
    return (
      <Shell>
        <p style={{ margin: "16px 0 0", fontSize: "17px", color: "var(--ink-2)" }}>
          No user with that id.
        </p>
      </Shell>
    );
  }

  if (loading || !user) {
    return (
      <Shell>
        <p className="meta" style={{ marginTop: "16px" }}>
          Loading&hellip;
        </p>
      </Shell>
    );
  }

  // Anonymized accounts keep a _deleted_<id> handle. Show the same label
  // the public surfaces use rather than leaking the raw tombstone handle.
  const displayHandle = isDeletedHandle(user.handle)
    ? DELETED_USER_LABEL
    : `@${user.handle}`;
  const blockedCount = reviews.filter(
    (r) => r.moderationStatus === "BLOCKED",
  ).length;

  return (
    <Shell>
      <header style={{ paddingTop: "16px" }}>
        <h1 className="h1">{displayHandle}</h1>
        <div className="meta" style={{ marginTop: "10px", fontSize: "15px" }}>
          {user.name ? `${user.name} · ` : ""}joined {fmt(user.createdAt)}
          {" · "}
          {openReportCount} open report{openReportCount === 1 ? "" : "s"}
          {" · "}
          {blockedCount} blocked review{blockedCount === 1 ? "" : "s"}
        </div>
        <div className="meta" style={{ marginTop: "6px", fontSize: "13px" }}>
          id {user.id}
        </div>
      </header>

      {/* Suspension — the reverse of an action the queue can no longer offer. */}
      <section style={{ marginTop: "28px" }}>
        <h2 className="h3">Account status</h2>
        {user.suspendedAt ? (
          <div style={{ marginTop: "10px" }}>
            <p style={{ margin: 0, fontSize: "17px" }}>
              Suspended {fmt(user.suspendedAt)}
            </p>
            {user.suspensionReason ? (
              <p className="meta" style={{ margin: "6px 0 0" }}>
                Reason: {user.suspensionReason}
              </p>
            ) : null}
            <div style={{ marginTop: "12px" }}>
              <button
                className="btn btn-sm btn-secondary"
                disabled={busy === "unsuspend"}
                onClick={() =>
                  act(
                    "/admin/moderation/unsuspend",
                    { userId: user.id },
                    "unsuspend",
                  )
                }
              >
                Unsuspend user
              </button>
            </div>
          </div>
        ) : (
          <p className="meta" style={{ margin: "10px 0 0" }}>
            Active — not suspended.
          </p>
        )}
      </section>

      {/* All reviews, including BLOCKED ones the public surfaces hide. */}
      <section style={{ marginTop: "32px" }}>
        <h2 className="h3">Reviews ({reviews.length})</h2>
        {reviews.length === 0 ? (
          <p className="meta" style={{ margin: "10px 0 0" }}>
            No reviews.
          </p>
        ) : (
          <div className="stack" style={{ gap: "14px", marginTop: "12px" }}>
            {reviews.map((r) => {
              const blocked = r.moderationStatus === "BLOCKED";
              return (
                <article
                  key={r.id}
                  style={{
                    borderTop: "1px solid var(--line)",
                    paddingTop: "12px",
                  }}
                >
                  <div className="meta" style={{ fontSize: "13px" }}>
                    {r.ratingOverall}★ · {fmt(r.createdAt)} ·{" "}
                    <Link href={`/show/${r.showId}`} className="link">
                      show
                    </Link>
                    {blocked ? (
                      <>
                        {" · "}
                        <strong style={{ color: "var(--danger, #b00)" }}>
                          BLOCKED
                        </strong>
                      </>
                    ) : (
                      <> · {r.moderationStatus}</>
                    )}
                  </div>
                  <p style={{ margin: "6px 0 0", fontSize: "16px" }}>
                    {r.reviewTextRaw?.trim() ? (
                      r.reviewTextRaw
                    ) : (
                      <span className="meta">(rating only, no text)</span>
                    )}
                  </p>
                  {blocked && (
                    <div style={{ marginTop: "10px" }}>
                      <button
                        className="btn btn-sm btn-secondary"
                        disabled={busy === r.id}
                        onClick={() =>
                          act(
                            "/admin/moderation/restore",
                            { targetType: "REVIEW", targetId: r.id },
                            r.id,
                          )
                        }
                      >
                        Restore review
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="page">
      <div
        className="container-md"
        style={{ paddingTop: "20px", paddingBottom: "80px" }}
      >
        <Link href="/admin/moderation" className="link">
          ← Moderation queue
        </Link>
        {children}
      </div>
    </main>
  );
}
