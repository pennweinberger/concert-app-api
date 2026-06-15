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
        Verify email
      </h1>

      {missingToken && status.kind === "ready" && (
        <div
          style={{
            background: "#1f1f1f",
            padding: "12px",
            borderRadius: "12px",
            marginBottom: "16px",
            color: "#ff8080",
          }}
        >
          No token in the link. Use the link from your email.
        </div>
      )}

      {!missingToken && status.kind === "ready" && (
        <>
          <p style={{ color: "#aaa", marginBottom: "20px" }}>
            Click the button below to confirm your email address.
          </p>
          <button
            onClick={verify}
            style={{
              width: "100%",
              padding: "14px",
              borderRadius: "12px",
              border: "none",
              background: "#f4f1ea",
              color: "#0a0a0a",
              cursor: "pointer",
              fontWeight: "bold",
              marginBottom: "20px",
            }}
          >
            Verify my email
          </button>
        </>
      )}

      {status.kind === "verifying" && (
        <div style={{ color: "#aaa" }}>Verifying…</div>
      )}

      {status.kind === "ok" && (
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
            Email verified
            {status.email ? `: ${status.email}` : ""}.
          </div>
          <Link
            href="/"
            style={{
              color: "#f4f1ea",
              textDecoration: "underline",
              textUnderlineOffset: "3px",
            }}
          >
            ← Back to feed
          </Link>
        </>
      )}

      {status.kind === "error" && (
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
            {status.message}
          </div>
          <div style={{ color: "#aaa", fontSize: "14px" }}>
            If your link expired, sign in and request a new verification
            email from the banner.
          </div>
          <div style={{ marginTop: "20px" }}>
            <Link
              href="/"
              style={{
                color: "#f4f1ea",
                textDecoration: "underline",
                textUnderlineOffset: "3px",
              }}
            >
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
    <main
      style={{
        background: "#0a0a0a",
        minHeight: "100vh",
        color: "#f4f1ea",
        padding: "24px",
      }}
    >
      <Suspense fallback={<div style={{ color: "#aaa" }}>Loading…</div>}>
        <VerifyEmailInner />
      </Suspense>
    </main>
  );
}
