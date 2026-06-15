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
      style={{
        background: "#2a2517",
        color: "#f4f1ea",
        padding: "12px 16px",
        borderBottom: "1px solid #3a3525",
        fontSize: "14px",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "12px",
        justifyContent: "center",
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
          Resend verification email
        </button>
      )}
      {sendState.kind === "sending" && (
        <span style={{ color: "#aaa" }}>Sending…</span>
      )}
      {sendState.kind === "sent" && (
        <span style={{ color: "#9be597" }}>
          Sent. Check your inbox.
        </span>
      )}
      {sendState.kind === "error" && (
        <span style={{ color: "#ff8080" }}>{sendState.message}</span>
      )}
    </div>
  );
}
