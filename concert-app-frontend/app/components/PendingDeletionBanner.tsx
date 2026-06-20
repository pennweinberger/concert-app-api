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
      style={{
        background: "#3a1f1f",
        color: "#f4f1ea",
        padding: "12px 16px",
        borderBottom: "1px solid #5a2525",
        fontSize: "14px",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "12px",
        justifyContent: "center",
      }}
    >
      <span>
        Your account is scheduled for deletion
        {scheduledLabel ? ` on ${scheduledLabel}` : ""}.
      </span>
      {cancelState.kind === "idle" && (
        <button
          onClick={cancel}
          style={{
            background: "transparent",
            border: "1px solid #f4f1ea",
            color: "#f4f1ea",
            padding: "6px 12px",
            borderRadius: "999px",
            cursor: "pointer",
            fontSize: "13px",
          }}
        >
          Cancel deletion
        </button>
      )}
      {cancelState.kind === "cancelling" && (
        <span style={{ color: "#aaa" }}>Cancelling…</span>
      )}
      {cancelState.kind === "ok" && (
        <span style={{ color: "#9be597" }}>Cancelled.</span>
      )}
      {cancelState.kind === "error" && (
        <span style={{ color: "#ff8080" }}>{cancelState.message}</span>
      )}
    </div>
  );
}
