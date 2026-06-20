"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

// Important: we deliberately do NOT auto-POST on mount. Email security
// scanners (Outlook Safe Links / Defender, corporate firewalls) routinely
// fetch URLs from incoming mail and sometimes execute the page's JS to
// detect malicious content. If the reset fired on mount, those scanners
// would consume the single-use token before the real recipient ever
// reached the form. Requiring an explicit button click is the standard
// mitigation — scanners GET and sometimes run JS, but they do not click.
type Status =
  | { kind: "ready" }
  | { kind: "submitting" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "ready" });

  async function submit() {
    if (!token) return;
    if (newPassword.length < 8 || newPassword.length > 128) {
      setStatus({
        kind: "error",
        message: "Password must be 8-128 characters.",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus({
        kind: "error",
        message: "Passwords do not match.",
      });
      return;
    }

    setStatus({ kind: "submitting" });
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus({ kind: "ok" });
        return;
      }
      setStatus({
        kind: "error",
        message:
          (data?.error as string | undefined) ??
          "Could not reset password.",
      });
    } catch {
      setStatus({
        kind: "error",
        message: "Network error. Try again.",
      });
    }
  }

  return (
    <div style={{ maxWidth: "420px", margin: "60px auto 0" }}>
      <h1
        style={{
          fontSize: "30px",
          marginBottom: "24px",
          fontFamily: "var(--font-display), sans-serif",
          fontWeight: 700,
          letterSpacing: "-0.02em",
        }}
      >
        Set new password
      </h1>

      {!token && (
        <>
          <div
            style={{
              background: "#1f1f1f",
              padding: "12px",
              borderRadius: "12px",
              marginBottom: "16px",
              color: "#ff8080",
            }}
          >
            No reset token in the link. Use the link from your email, or
            request a new one.
          </div>
          <Link
            href="/forgot-password"
            style={{
              color: "#f4f1ea",
              fontSize: "14px",
              textDecoration: "underline",
              textUnderlineOffset: "3px",
            }}
          >
            Request a new reset link
          </Link>
        </>
      )}

      {token && status.kind === "ok" && (
        <>
          <div
            style={{
              background: "#1f1f1f",
              padding: "12px",
              borderRadius: "12px",
              marginBottom: "16px",
              color: "#9be597",
            }}
          >
            Password changed. You can sign in with your new password now.
          </div>
          <Link
            href="/signin"
            style={{
              color: "#f4f1ea",
              fontSize: "14px",
              textDecoration: "underline",
              textUnderlineOffset: "3px",
            }}
          >
            → Sign in
          </Link>
        </>
      )}

      {token && status.kind !== "ok" && (
        <>
          <div style={{ marginBottom: "14px" }}>
            <label
              style={{
                display: "block",
                color: "#aaa",
                marginBottom: "6px",
                fontSize: "14px",
              }}
            >
              New password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              style={{
                width: "100%",
                padding: "14px",
                borderRadius: "12px",
                border: "1px solid #333",
                background: "#1a1a1a",
                color: "white",
                boxSizing: "border-box",
              }}
            />
            <div
              style={{ color: "#777", fontSize: "12px", marginTop: "6px" }}
            >
              8-128 characters.
            </div>
          </div>

          <div style={{ marginBottom: "20px" }}>
            <label
              style={{
                display: "block",
                color: "#aaa",
                marginBottom: "6px",
                fontSize: "14px",
              }}
            >
              Confirm new password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              autoComplete="new-password"
              style={{
                width: "100%",
                padding: "14px",
                borderRadius: "12px",
                border: "1px solid #333",
                background: "#1a1a1a",
                color: "white",
                boxSizing: "border-box",
              }}
            />
          </div>

          {status.kind === "error" && (
            <div
              style={{
                background: "#1f1f1f",
                padding: "12px",
                borderRadius: "12px",
                marginBottom: "16px",
                color: "#ff8080",
              }}
            >
              {status.message}
            </div>
          )}

          <button
            onClick={submit}
            disabled={status.kind === "submitting"}
            style={{
              width: "100%",
              padding: "14px",
              borderRadius: "12px",
              border: "none",
              background:
                status.kind === "submitting" ? "#555" : "#f4f1ea",
              color: status.kind === "submitting" ? "#aaa" : "#0a0a0a",
              cursor:
                status.kind === "submitting" ? "not-allowed" : "pointer",
              fontWeight: "bold",
              marginBottom: "20px",
            }}
          >
            {status.kind === "submitting"
              ? "Setting password…"
              : "Set new password"}
          </button>
        </>
      )}

      <div style={{ textAlign: "center", marginTop: "20px" }}>
        <Link
          href="/signin"
          style={{
            color: "#aaa",
            fontSize: "14px",
            textDecoration: "underline",
            textUnderlineOffset: "3px",
          }}
        >
          ← Back to sign in
        </Link>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <main
      style={{
        background: "#0a0a0a",
        minHeight: "100vh",
        color: "#f4f1ea",
        padding: "24px",
      }}
    >
      <Suspense fallback={<div style={{ color: "#aaa" }}>Loading…</div>}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
