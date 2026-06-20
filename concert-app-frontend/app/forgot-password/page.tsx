"use client";

import { Suspense, useState } from "react";
import Link from "next/link";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done" }
  | { kind: "error"; message: string };

function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function submit() {
    setStatus({ kind: "sending" });
    try {
      const res = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      // Backend always returns 200 (anti-enumeration). Treat any 2xx
      // as success and show the same message regardless.
      if (res.ok) {
        setStatus({ kind: "done" });
        return;
      }
      setStatus({
        kind: "error",
        message: "Could not start password reset. Try again in a moment.",
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
          marginBottom: "12px",
          fontFamily: "var(--font-display), sans-serif",
          fontWeight: 700,
          letterSpacing: "-0.02em",
        }}
      >
        Forgot password
      </h1>
      <p style={{ color: "#aaa", marginBottom: "24px", fontSize: "14px" }}>
        Enter the email on your account and we will send you a link to set
        a new password.
      </p>

      {status.kind !== "done" && (
        <>
          <div style={{ marginBottom: "20px" }}>
            <label
              style={{
                display: "block",
                color: "#aaa",
                marginBottom: "6px",
                fontSize: "14px",
              }}
            >
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="you@example.com"
              autoComplete="email"
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
            disabled={status.kind === "sending"}
            style={{
              width: "100%",
              padding: "14px",
              borderRadius: "12px",
              border: "none",
              background: status.kind === "sending" ? "#555" : "#f4f1ea",
              color: status.kind === "sending" ? "#aaa" : "#0a0a0a",
              cursor:
                status.kind === "sending" ? "not-allowed" : "pointer",
              fontWeight: "bold",
              marginBottom: "20px",
            }}
          >
            {status.kind === "sending" ? "Sending…" : "Send reset link"}
          </button>
        </>
      )}

      {status.kind === "done" && (
        <div
          style={{
            background: "#1f1f1f",
            padding: "12px",
            borderRadius: "12px",
            marginBottom: "16px",
            color: "#9be597",
          }}
        >
          If an account exists for that email, we sent a reset link. Check
          your inbox.
        </div>
      )}

      <div style={{ textAlign: "center", marginTop: "20px" }}>
        <Link
          href="/signin"
          style={{
            color: "#f4f1ea",
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

export default function ForgotPasswordPage() {
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
        <ForgotPasswordForm />
      </Suspense>
    </main>
  );
}
