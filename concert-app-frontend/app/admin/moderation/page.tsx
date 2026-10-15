"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getToken, authHeaders, useAuthUser } from "../../lib/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type QueueItem = {
  targetType: "REVIEW" | "COMMENT" | "USER";
  targetId: string;
  reportCount: number;
  reasons: { reason: string; count: number }[];
  detailsSamples: string[];
  firstReportedAt: string;
  lastReportedAt: string;
  content:
    | { kind: "review"; text: string; blocked: boolean }
    | { kind: "comment"; body: string; blocked: boolean }
    | { kind: "user"; handle: string; name: string | null; suspended: boolean }
    | null;
  author: { id: string; handle: string; name: string | null } | null;
  link: string | null;
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString();
}

export default function AdminModerationPage() {
  const router = useRouter();
  const authUser = useAuthUser();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [lookup, setLookup] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);

  /**
   * Open a user's admin page from a handle or a raw user id.
   *
   * The queue empties as soon as an item is actioned, so a link from a
   * queue row is not a durable way back to Restore / Unsuspend. This is.
   *
   * Three cases, because /users/:handle deliberately 404s anonymized
   * accounts (`if (!user || user.anonymizedAt)`):
   *   - `_deleted_<id>`  the id IS the handle suffix — no lookup needed
   *   - a cuid           already an id — go straight there
   *   - anything else    resolve the handle via the public profile API
   * Suspended users resolve normally; only `anonymizedAt` is filtered.
   */
  async function openUser(raw: string) {
    const input = raw.trim().replace(/^@/, "");
    if (!input) return;
    setLookupError(null);

    if (input.startsWith("_deleted_")) {
      router.push(`/admin/users/${input.slice("_deleted_".length)}`);
      return;
    }
    if (/^c[a-z0-9]{20,30}$/i.test(input)) {
      router.push(`/admin/users/${input}`);
      return;
    }

    setLookupBusy(true);
    try {
      const res = await fetch(
        `${API_BASE}/users/${encodeURIComponent(input)}`,
      );
      if (!res.ok) {
        setLookupError(
          "No such handle. Anonymized accounts have no public profile — " +
            "paste their user id (or their _deleted_… handle) instead.",
        );
        return;
      }
      const data = await res.json();
      if (!data?.id) {
        setLookupError("That profile returned no id.");
        return;
      }
      router.push(`/admin/users/${data.id}`);
    } catch {
      setLookupError("Lookup failed. Check the connection and try again.");
    } finally {
      setLookupBusy(false);
    }
  }

  const load = useCallback(async () => {
    if (!getToken()) {
      router.replace("/signin?next=/admin/moderation");
      return;
    }
    const res = await fetch(`${API_BASE}/admin/reports`, { headers: authHeaders() });
    if (res.status === 401) {
      router.replace("/signin?next=/admin/moderation");
      return;
    }
    if (res.status === 403) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    const data = await res.json();
    setItems(data.items ?? []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

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
      <main className="page">
        <div
          className="container-md"
          style={{ paddingTop: "20px", paddingBottom: "80px" }}
        >
          <BackToFeed />
          <p style={{ margin: "16px 0 0", fontSize: "17px", color: "var(--ink-2)" }}>
            You don&rsquo;t have access to this page.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="container-md" style={{ paddingTop: "20px", paddingBottom: "32px" }}>
        <BackToFeed />
        <header style={{ paddingTop: "16px" }}>
          <h1 className="h1">Moderation queue</h1>
          <div className="meta" style={{ marginTop: "10px", fontSize: "15px" }}>
            {authUser?.isAdmin === false ? "" : `${items.length} open item${items.length === 1 ? "" : "s"}`}
          </div>

          {/* Durable entry point to a user's admin page. Actioning an item
              resolves its reports and drops it from this queue, so without
              this there is no way back to Restore / Unsuspend. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              openUser(lookup);
            }}
            style={{ marginTop: "16px", display: "flex", gap: "8px", flexWrap: "wrap" }}
          >
            <input
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              placeholder="handle, _deleted_… or user id"
              aria-label="Open a user's admin page by handle or id"
              className="input"
              style={{ maxWidth: "320px" }}
            />
            <button
              type="submit"
              className="btn btn-sm btn-outline"
              disabled={lookupBusy || !lookup.trim()}
            >
              {lookupBusy ? "Opening…" : "Open user"}
            </button>
          </form>
          {lookupError && (
            <p className="meta" style={{ margin: "8px 0 0", fontSize: "13px" }}>
              {lookupError}
            </p>
          )}
        </header>
      </div>

      <section className="band">
        <div
          className="container-md"
          style={{
            paddingTop: "clamp(28px, 4vw, 48px)",
            paddingBottom: "clamp(40px, 6vw, 80px)",
          }}
        >
          {loading && <div className="meta">Loading…</div>}
          {!loading && items.length === 0 && (
            <div
              className="card"
              style={{
                textAlign: "center",
                padding: "48px 24px",
                fontSize: "17px",
                color: "var(--ink-2)",
              }}
            >
              Queue is clear.
            </div>
          )}

          <div className="stack" style={{ gap: "14px" }}>
            {items.map((it) => {
              const key = `${it.targetType}:${it.targetId}`;
              const isContent = it.targetType === "REVIEW" || it.targetType === "COMMENT";
              const blocked =
                it.content && (it.content.kind === "review" || it.content.kind === "comment")
                  ? it.content.blocked
                  : false;
              const suspended =
                it.content && it.content.kind === "user" ? it.content.suspended : false;

              return (
                <div key={key} className="card">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: "6px 12px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "12.5px",
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        color: "var(--danger)",
                      }}
                    >
                      {it.targetType} · {it.reportCount} report{it.reportCount === 1 ? "" : "s"}
                      {blocked && " · BLOCKED"}
                      {suspended && " · SUSPENDED"}
                    </div>
                    <div className="meta" style={{ fontSize: "13px" }}>
                      {fmt(it.firstReportedAt)} → {fmt(it.lastReportedAt)}
                    </div>
                  </div>

                  {/* Reported content */}
                  <div
                    style={{
                      margin: "14px 0",
                      fontSize: "17px",
                      lineHeight: 1.5,
                      color: "var(--ink)",
                    }}
                  >
                    {it.content === null && (
                      <em style={{ color: "var(--muted)" }}>[content removed]</em>
                    )}
                    {it.content?.kind === "review" && <span>“{it.content.text}”</span>}
                    {it.content?.kind === "comment" && <span>“{it.content.body}”</span>}
                    {it.content?.kind === "user" && (
                      <span>@{it.content.handle}{it.content.name ? ` (${it.content.name})` : ""}</span>
                    )}
                  </div>

                  {/* Author + reasons */}
                  <div style={{ fontSize: "14px", color: "var(--ink-2)", marginBottom: "6px" }}>
                    {it.author && (
                      <>by <strong>@{it.author.handle}</strong> · </>
                    )}
                    {it.reasons.map((r) => `${r.reason} ×${r.count}`).join(", ")}
                  </div>
                  {it.detailsSamples.length > 0 && (
                    <div className="meta" style={{ fontSize: "13px", marginBottom: "6px" }}>
                      notes: {it.detailsSamples.map((d) => `“${d}”`).join(" · ")}
                    </div>
                  )}

                  {/* Quick links */}
                  <div style={{ display: "flex", gap: "4px 18px", flexWrap: "wrap", margin: "8px 0" }}>
                    {it.link && (
                      <Link href={it.link} className="link" style={quickLinkStyle}>
                        View {it.targetType === "USER" ? "profile" : "in context"}
                        <ArrowUpRight />
                      </Link>
                    )}
                    {it.author && (
                      <Link href={`/user/${it.author.handle}`} className="link" style={quickLinkStyle}>
                        Author profile + reviews
                        <ArrowUpRight />
                      </Link>
                    )}
                    {/* The admin surface that survives this item leaving the
                        queue. Acting here resolves the reports, so this link
                        is the only way back to Restore / Unsuspend. */}
                    {it.author && (
                      <Link
                        href={`/admin/users/${it.author.id}`}
                        className="link"
                        style={quickLinkStyle}
                      >
                        Admin: manage user
                        <ArrowUpRight />
                      </Link>
                    )}
                  </div>

                  {/* Actions */}
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      flexWrap: "wrap",
                      marginTop: "14px",
                      paddingTop: "16px",
                      borderTop: "1px solid var(--line-soft)",
                    }}
                  >
                    {isContent && !blocked && (
                      <ActionBtn label="Block" tone="danger" disabled={busy === key}
                        onClick={() => act("/admin/moderation/block", { targetType: it.targetType, targetId: it.targetId }, key)} />
                    )}
                    {isContent && blocked && (
                      <ActionBtn label="Restore" tone="secondary" disabled={busy === key}
                        onClick={() => act("/admin/moderation/restore", { targetType: it.targetType, targetId: it.targetId }, key)} />
                    )}
                    {it.author && !suspended && (
                      <ActionBtn label="Suspend user" tone="danger" disabled={busy === key}
                        onClick={() => act("/admin/moderation/suspend", { userId: it.author!.id }, key)} />
                    )}
                    {it.author && suspended && (
                      <ActionBtn label="Unsuspend user" tone="secondary" disabled={busy === key}
                        onClick={() => act("/admin/moderation/unsuspend", { userId: it.author!.id }, key)} />
                    )}
                    <ActionBtn label="Dismiss all" tone="outline" disabled={busy === key}
                      onClick={() => act("/admin/moderation/dismiss-target", { targetType: it.targetType, targetId: it.targetId }, key)} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}

const quickLinkStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "3px",
  minHeight: "32px",
  fontSize: "14px",
} as const;

function ArrowUpRight() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 17L17 7M8 7h9v9" />
    </svg>
  );
}

function BackToFeed() {
  return (
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
      Back to feed
    </Link>
  );
}

function ActionBtn({
  label,
  tone,
  onClick,
  disabled,
}: {
  label: string;
  tone: "danger" | "secondary" | "outline";
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`btn btn-sm btn-${tone}`}
    >
      {label}
    </button>
  );
}
