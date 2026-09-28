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
    <div
      className="container-xs"
      style={{ paddingTop: "clamp(40px,8vw,96px)", paddingBottom: "80px" }}
    >
      <h1 className="h1" style={{ marginBottom: "12px" }}>
        Forgot password
      </h1>
      <p
        style={{
          color: "var(--muted)",
          margin: "0 0 32px",
          fontSize: "16px",
          lineHeight: 1.5,
        }}
      >
        Enter the email on your account and we will send you a link to set
        a new password.
      </p>

      {status.kind !== "done" && (
        <>
          <div className="field" style={{ marginBottom: "24px" }}>
            <label className="label" htmlFor="forgot-email">
              Email
            </label>
            <input
              id="forgot-email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>

          {status.kind === "error" && (
            <div
              className="notice notice-error"
              role="alert"
              style={{ marginBottom: "16px" }}
            >
              {status.message}
            </div>
          )}

          <button
            onClick={submit}
            disabled={status.kind === "sending"}
            className="btn btn-primary btn-lg btn-block"
            style={{ marginBottom: "4px" }}
          >
            {status.kind === "sending" ? "Sending…" : "Send reset link"}
          </button>
        </>
      )}

      {status.kind === "done" && (
        <div
          className="notice notice-success"
          role="status"
          style={{ marginBottom: "16px" }}
        >
          If an account exists for that email, we sent a reset link. Check
          your inbox.
        </div>
      )}

      <div style={{ textAlign: "center", marginTop: "24px" }}>
        <Link href="/signin" className="link" style={{ fontSize: "15px" }}>
          ← Back to sign in
        </Link>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <main className="page">
      <Suspense
        fallback={
          <div
            className="container-xs meta"
            style={{ paddingTop: "clamp(40px,8vw,96px)" }}
          >
            Loading…
          </div>
        }
      >
        <ForgotPasswordForm />
      </Suspense>
    </main>
  );
}
