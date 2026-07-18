"use client";

import { useState } from "react";
import { authHeaders } from "../lib/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

/**
 * Shown when an unverified user tries to publish a review or comment.
 * Their draft is preserved by the caller (it stays in component state) —
 * this modal just nudges verification, then lets them retry publishing
 * the exact thing they wrote once they've verified.
 */
export default function VerifyToPublishModal({
  open,
  kind,
  onClose,
  onRetry,
  retrying,
}: {
  open: boolean;
  kind: "review" | "comment";
  onClose: () => void;
  /** Re-attempt the original publish. The draft is still in state. */
  onRetry: () => void;
  retrying?: boolean;
}) {
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  if (!open) return null;

  async function resend() {
    setResending(true);
    setResendError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/resend-verification`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!res.ok && res.status !== 429) {
        setResendError("Could not resend. Try again shortly.");
      } else if (res.status === 429) {
        setResendError("Too many requests — check your inbox, then try again later.");
      } else {
        setResent(true);
      }
    } catch {
      setResendError("Network error. Try again.");
    } finally {
      setResending(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#141414",
          border: "1px solid #333",
          borderRadius: "16px",
          padding: "24px",
          width: "100%",
          maxWidth: "420px",
          color: "#f4f1ea",
        }}
      >
        <div style={{ fontSize: "20px", fontWeight: 700, marginBottom: "10px" }}>
          Almost there!
        </div>
        <p style={{ color: "#cfcfcf", lineHeight: 1.5, marginBottom: "6px" }}>
          Verify your email to publish {kind === "review" ? "reviews" : "comments"} and
          help keep Afterset spam-free.
        </p>
        <p style={{ color: "#888", fontSize: "13px", marginBottom: "18px" }}>
          Your {kind} is saved — verify, then hit “I&rsquo;ve verified” and it&rsquo;ll
          publish right away. No need to retype anything.
        </p>

        {resent && (
          <div style={{ color: "#7dff9b", fontSize: "13px", marginBottom: "12px" }}>
            Verification email sent — check your inbox.
          </div>
        )}
        {resendError && (
          <div style={{ color: "#ff8080", fontSize: "13px", marginBottom: "12px" }}>
            {resendError}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <button
            onClick={onRetry}
            disabled={retrying}
            style={{
              padding: "12px",
              borderRadius: "10px",
              border: "none",
              background: retrying ? "#555" : "#f4f1ea",
              color: retrying ? "#aaa" : "#0a0a0a",
              fontWeight: "bold",
              cursor: retrying ? "not-allowed" : "pointer",
            }}
          >
            {retrying ? "Publishing…" : "I've verified my email"}
          </button>
          <button
            onClick={resend}
            disabled={resending}
            style={{
              padding: "12px",
              borderRadius: "10px",
              border: "1px solid #333",
              background: "none",
              color: "#f4f1ea",
              cursor: resending ? "not-allowed" : "pointer",
            }}
          >
            {resending ? "Sending…" : "Resend verification email"}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: "8px",
              borderRadius: "10px",
              border: "none",
              background: "none",
              color: "#888",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
