"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { refreshUser } from "../lib/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

// Important: we deliberately do NOT auto-POST on mount. Email security
// scanners (Outlook Safe Links / Defender, corporate firewalls) routinely
// fetch URLs from incoming mail and sometimes execute the page's JS to
// detect malicious content. If verification fired on mount, those
// scanners would consume the single-use token before the real recipient
// ever clicked. Requiring an explicit button click is the standard
// mitigation — scanners GET and sometimes run JS, but they do not click.
type Status =
  | { kind: "ready" }
  | { kind: "verifying" }
  | { kind: "ok"; email: string | null }
  | { kind: "error"; message: string };

function VerifyEmailInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>({ kind: "ready" });

  const missingToken = !token;

  async function verify() {
    if (!token) return;
    setStatus({ kind: "verifying" });
    try {
      const res = await fetch(
        `${API_BASE}/auth/verify-email/${encodeURIComponent(token)}`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus({
          kind: "error",
          message:
            data?.error ||
            "This verification link is invalid or has expired.",
        });
        return;
      }
      await refreshUser(API_BASE);
      setStatus({
        kind: "ok",
        email: (data?.email as string | null) ?? null,
      });
    } catch {
      setStatus({
        kind: "error",
        message: "Could not reach the server. Try again in a moment.",
      });
    }
  }

  return (
    <div
      className="container-xs"
      style={{ paddingTop: "clamp(40px,8vw,96px)", paddingBottom: "80px" }}
    >
      <h1 className="h1" style={{ marginBottom: "24px" }}>
        Verify email
      </h1>

      {missingToken && status.kind === "ready" && (
        <div
          className="notice notice-error"
          role="alert"
          style={{ marginBottom: "16px" }}
        >
          No token in the link. Use the link from your email.
        </div>
      )}

      {!missingToken && status.kind === "ready" && (
        <>
          <p
            style={{
            color: "var(--ink-2)",
            margin: "0 0 24px",
            fontSize: "16px",
            lineHeight: 1.55,
          }}
          >
            Click the button below to confirm your email address.
          </p>
          <button
            onClick={verify}
            className="btn btn-primary btn-lg btn-block"
            style={{ marginBottom: "20px" }}
          >
            Verify my email
          </button>
        </>
      )}

      {status.kind === "verifying" && (
        <div className="meta" role="status">
          Verifying…
        </div>
      )}

      {status.kind === "ok" && (
        <>
          <div
            className="notice notice-success"
            role="status"
            style={{ marginBottom: "16px" }}
          >
            Email verified
            {status.email ? `: ${status.email}` : ""}.
          </div>
          <Link href="/" className="link" style={{ fontSize: "15px" }}>
            ← Back to feed
          </Link>
        </>
      )}

      {status.kind === "error" && (
        <>
          <div
            className="notice notice-error"
            role="alert"
            style={{ marginBottom: "16px" }}
          >
            {status.message}
          </div>
          <div style={{ color: "var(--muted)", fontSize: "14.5px" }}>
            If your link expired, sign in and request a new verification
            email from the banner.
          </div>
          <div style={{ marginTop: "20px" }}>
            <Link href="/" className="link" style={{ fontSize: "15px" }}>
              ← Back to feed
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
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
        <VerifyEmailInner />
      </Suspense>
    </main>
  );
}
