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
      <main style={{ background: "#0a0a0a", minHeight: "100vh", color: "#f4f1ea", padding: "24px" }}>
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>
          <p>You don&rsquo;t have access to this page.</p>
          <Link href="/" style={{ color: "#f4f1ea" }}>← Back to feed</Link>
        </div>
      </main>
    );
  }

  return (
    <main style={{ background: "#0a0a0a", minHeight: "100vh", color: "#f4f1ea", padding: "24px" }}>
      <div style={{ maxWidth: "760px", margin: "0 auto" }}>
        <div style={{ marginBottom: "20px" }}>
          <Link href="/" style={{ color: "#f4f1ea", textDecoration: "underline", textUnderlineOffset: "3px" }}>
            ← Back to feed
          </Link>
        </div>
        <h1 style={{ fontSize: "28px", fontWeight: 700, marginBottom: "6px" }}>Moderation queue</h1>
        <div style={{ color: "#888", marginBottom: "20px" }}>
          {authUser?.isAdmin === false ? "" : `${items.length} open item${items.length === 1 ? "" : "s"}`}
        </div>

        {loading && <div style={{ color: "#888" }}>Loading…</div>}
        {!loading && items.length === 0 && (
          <div style={{ color: "#888", padding: "16px" }}>Queue is clear. 🎉</div>
        )}

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
            <div
              key={key}
              style={{
                background: "#141414",
                border: "1px solid #2a2a2a",
                borderRadius: "12px",
                padding: "16px",
                marginBottom: "12px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "10px" }}>
                <div style={{ fontSize: "12px", color: "#ff8080", fontWeight: 700 }}>
                  {it.targetType} · {it.reportCount} report{it.reportCount === 1 ? "" : "s"}
                  {blocked && " · BLOCKED"}
                  {suspended && " · SUSPENDED"}
                </div>
                <div style={{ fontSize: "12px", color: "#777" }}>
                  {fmt(it.firstReportedAt)} → {fmt(it.lastReportedAt)}
                </div>
              </div>

              {/* Reported content */}
              <div style={{ margin: "10px 0", color: "#e8e8e8" }}>
                {it.content === null && <em style={{ color: "#777" }}>[content removed]</em>}
                {it.content?.kind === "review" && <span>“{it.content.text}”</span>}
                {it.content?.kind === "comment" && <span>“{it.content.body}”</span>}
                {it.content?.kind === "user" && (
                  <span>@{it.content.handle}{it.content.name ? ` (${it.content.name})` : ""}</span>
                )}
              </div>

              {/* Author + reasons */}
              <div style={{ fontSize: "13px", color: "#aaa", marginBottom: "6px" }}>
                {it.author && (
                  <>by <strong>@{it.author.handle}</strong> · </>
                )}
                {it.reasons.map((r) => `${r.reason} ×${r.count}`).join(", ")}
              </div>
              {it.detailsSamples.length > 0 && (
                <div style={{ fontSize: "12px", color: "#888", marginBottom: "6px" }}>
                  notes: {it.detailsSamples.map((d) => `“${d}”`).join(" · ")}
                </div>
              )}

              {/* Quick links */}
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", margin: "8px 0" }}>
                {it.link && (
                  <Link href={it.link} style={{ color: "#7dafff", fontSize: "13px" }}>
                    View {it.targetType === "USER" ? "profile" : "in context"} ↗
                  </Link>
                )}
                {it.author && (
                  <Link href={`/user/${it.author.handle}`} style={{ color: "#7dafff", fontSize: "13px" }}>
                    Author profile + reviews ↗
                  </Link>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" }}>
                {isContent && !blocked && (
                  <ActionBtn label="Block" color="#ff4d6d" disabled={busy === key}
                    onClick={() => act("/admin/moderation/block", { targetType: it.targetType, targetId: it.targetId }, key)} />
                )}
                {isContent && blocked && (
                  <ActionBtn label="Restore" color="#7dff9b" disabled={busy === key}
                    onClick={() => act("/admin/moderation/restore", { targetType: it.targetType, targetId: it.targetId }, key)} />
                )}
                {it.author && !suspended && (
                  <ActionBtn label="Suspend user" color="#fbbf24" disabled={busy === key}
                    onClick={() => act("/admin/moderation/suspend", { userId: it.author!.id }, key)} />
                )}
                {it.author && suspended && (
                  <ActionBtn label="Unsuspend user" color="#7dff9b" disabled={busy === key}
                    onClick={() => act("/admin/moderation/unsuspend", { userId: it.author!.id }, key)} />
                )}
                <ActionBtn label="Dismiss all" color="#888" disabled={busy === key}
                  onClick={() => act("/admin/moderation/dismiss-target", { targetType: it.targetType, targetId: it.targetId }, key)} />
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}

function ActionBtn({
  label,
  color,
  onClick,
  disabled,
}: {
  label: string;
  color: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "none",
        border: `1px solid ${color}`,
        color,
        borderRadius: "8px",
        padding: "6px 12px",
        fontSize: "13px",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}
