"use client";

import { useEffect, useState } from "react";
import { refreshUser, useAuthUser, getToken } from "../lib/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

export default function VerifyEmailBanner() {
  const user = useAuthUser();
  const [sendState, setSendState] = useState<SendState>({ kind: "idle" });

  // Refresh user from /auth/me on mount so the banner reflects the true
  // server-side emailVerified state, not just the cached snapshot from
  // login/signup time. The cache can also lag behind a verification
  // performed in another tab.
  useEffect(() => {
    if (!getToken()) return;
    refreshUser(API_BASE);
  }, []);

  // Conditions for showing the banner:
  // 1. user is signed in
  // 2. user has an email on file
  // 3. user is not yet verified
  // The cached AuthUser may not have emailVerified populated for older
  // sessions — in that case refreshUser() above will fill it in shortly.
  if (!user) return null;
  if (!user.email) return null; // existing pre-email-feature accounts
  if (user.emailVerified) return null;

  async function resend() {
    setSendState({ kind: "sending" });
    try {
      const res = await fetch(`${API_BASE}/auth/resend-verification`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (res.ok) {
        setSendState({ kind: "sent" });
        return;
      }
      const data = await res.json().catch(() => ({}));
      setSendState({
        kind: "error",
        message:
          (data?.error as string | undefined) ??
          "Could not send. Try again later.",
      });
    } catch {
      setSendState({
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
          Verify your email
          {user.email ? ` (${user.email})` : ""} to fully activate your
          account.
        </span>
        {sendState.kind === "idle" && (
          <button
            onClick={resend}
            className="btn btn-outline btn-sm"
            style={{ height: "32px" }}
          >
            Resend verification email
          </button>
        )}
        {sendState.kind === "sending" && <span>Sending…</span>}
        {sendState.kind === "sent" && (
          <span style={{ color: "var(--success)", fontWeight: 500 }}>
            Sent. Check your inbox.
          </span>
        )}
        {sendState.kind === "error" && (
          <span style={{ color: "var(--danger)", fontWeight: 500 }}>
            {sendState.message}
          </span>
        )}
      </div>
    </div>
  );
}
