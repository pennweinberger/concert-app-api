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
        background: "rgba(0,0,0,0.4)",
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
          background: "var(--bg)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-lg)",
          padding: "32px 28px 24px",
          width: "100%",
          maxWidth: "420px",
          boxSizing: "border-box",
          color: "var(--ink)",
        }}
      >
        <h2 className="h3" style={{ marginBottom: "12px" }}>
          Almost there!
        </h2>
        <p
          style={{
            margin: "0 0 8px",
            fontSize: "16px",
            lineHeight: 1.5,
            color: "var(--ink-2)",
          }}
        >
          Verify your email to publish {kind === "review" ? "reviews" : "comments"} and
          help keep Afterset spam-free.
        </p>
        <p className="meta" style={{ margin: "0 0 20px", lineHeight: 1.5 }}>
          Your {kind} is saved — verify, then hit “I&rsquo;ve verified” and it&rsquo;ll
          publish right away. No need to retype anything.
        </p>

        {resent && (
          <div className="notice notice-success" style={{ marginBottom: "12px" }}>
            Verification email sent — check your inbox.
          </div>
        )}
        {resendError && (
          <div className="notice notice-error" style={{ marginBottom: "12px" }}>
            {resendError}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <button
            onClick={onRetry}
            disabled={retrying}
            className="btn btn-primary btn-block"
          >
            {retrying ? "Publishing…" : "I've verified my email"}
          </button>
          <button
            onClick={resend}
            disabled={resending}
            className="btn btn-secondary btn-block"
          >
            {resending ? "Sending…" : "Resend verification email"}
          </button>
          <button onClick={onClose} className="btn btn-ghost btn-block">
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
