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
