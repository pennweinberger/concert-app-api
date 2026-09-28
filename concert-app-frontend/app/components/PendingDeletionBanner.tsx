"use client";

import { useEffect, useState } from "react";
import { refreshUser, useAuthUser, getToken } from "../lib/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type CancelState =
  | { kind: "idle" }
  | { kind: "cancelling" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

export default function PendingDeletionBanner() {
  const user = useAuthUser();
  const [cancelState, setCancelState] = useState<CancelState>({
    kind: "idle",
  });

  // Pull fresh state from the server on mount so the banner reflects
  // the actual deletedAt status, not just the cached snapshot.
  useEffect(() => {
    if (!getToken()) return;
    refreshUser(API_BASE);
  }, []);

  if (!user) return null;
  if (!user.pendingDeletion) return null;

  const scheduledLabel = user.deletionScheduledFor
    ? new Date(user.deletionScheduledFor).toLocaleDateString()
    : null;

  async function cancel() {
    setCancelState({ kind: "cancelling" });
    try {
      const res = await fetch(`${API_BASE}/auth/cancel-delete`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (res.ok) {
        setCancelState({ kind: "ok" });
        // Refresh user so the banner disappears.
        await refreshUser(API_BASE);
        return;
      }
      const data = await res.json().catch(() => ({}));
      setCancelState({
        kind: "error",
        message:
          (data?.error as string | undefined) ?? "Could not cancel.",
      });
    } catch {
      setCancelState({
        kind: "error",
        message: "Could not reach the server.",
      });
    }
  }

  return (
    <div
      role="status"
      style={{
        background: "var(--warning-soft)",
        color: "var(--warning-ink)",
        borderBottom: "1px solid rgba(122, 75, 0, 0.12)",
        fontSize: "14px",
        lineHeight: 1.45,
      }}
    >
      <div
        className="container"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px 14px",
          paddingTop: "10px",
          paddingBottom: "10px",
          textAlign: "center",
        }}
      >
        <span>
          Your account is scheduled for deletion
          {scheduledLabel ? ` on ${scheduledLabel}` : ""}.
        </span>
        {cancelState.kind === "idle" && (
          <button
            onClick={cancel}
            className="btn btn-outline btn-sm"
            style={{ height: "32px" }}
          >
            Cancel deletion
          </button>
        )}
        {cancelState.kind === "cancelling" && <span>Cancelling…</span>}
        {cancelState.kind === "ok" && (
          <span style={{ color: "var(--success)", fontWeight: 500 }}>
            Cancelled.
          </span>
        )}
        {cancelState.kind === "error" && (
          <span style={{ color: "var(--danger)", fontWeight: 500 }}>
            {cancelState.message}
          </span>
        )}
      </div>
    </div>
  );
}
