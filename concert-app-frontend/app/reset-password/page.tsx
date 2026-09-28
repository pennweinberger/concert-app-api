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
    <div
      className="container-xs"
      style={{ paddingTop: "clamp(40px,8vw,96px)", paddingBottom: "80px" }}
    >
      <h1 className="h1" style={{ marginBottom: "32px" }}>
        Set new password
      </h1>

      {!token && (
        <>
          <div
            className="notice notice-error"
            role="alert"
            style={{ marginBottom: "16px" }}
          >
            No reset token in the link. Use the link from your email, or
            request a new one.
          </div>
          <Link href="/forgot-password" className="link" style={{ fontSize: "15px" }}>
            Request a new reset link
          </Link>
        </>
      )}

      {token && status.kind === "ok" && (
        <>
          <div
            className="notice notice-success"
            role="status"
            style={{ marginBottom: "16px" }}
          >
            Password changed. You can sign in with your new password now.
          </div>
          <Link href="/signin" className="link" style={{ fontSize: "15px" }}>
            → Sign in
          </Link>
        </>
      )}

      {token && status.kind !== "ok" && (
        <>
          <div className="field" style={{ marginBottom: "18px" }}>
            <label className="label" htmlFor="reset-new-password">
              New password
            </label>
            <input
              id="reset-new-password"
              className="input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            <div className="hint">8-128 characters.</div>
          </div>

          <div className="field" style={{ marginBottom: "24px" }}>
            <label className="label" htmlFor="reset-confirm-password">
              Confirm new password
            </label>
            <input
              id="reset-confirm-password"
              className="input"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              autoComplete="new-password"
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
            disabled={status.kind === "submitting"}
            className="btn btn-primary btn-lg btn-block"
            style={{ marginBottom: "4px" }}
          >
            {status.kind === "submitting"
              ? "Setting password…"
              : "Set new password"}
          </button>
        </>
      )}

      <div style={{ textAlign: "center", marginTop: "24px" }}>
        <Link href="/signin" className="link" style={{ fontSize: "15px" }}>
          ← Back to sign in
        </Link>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
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
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
