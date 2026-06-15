"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { refreshUser } from "../lib/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type Status =
  | { kind: "loading" }
  | { kind: "ok"; email: string | null }
  | { kind: "error"; message: string };

function VerifyEmailInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    if (!token) {
      setStatus({
        kind: "error",
        message: "No token in the link. Use the link from your email.",
      });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/auth/verify-email/${encodeURIComponent(token)}`,
          { method: "POST" },
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (!res.ok) {
          setStatus({
            kind: "error",
            message:
              data?.error ||
              "This verification link is invalid or has expired.",
          });
          return;
        }

        // Refresh cached user so banner disappears immediately.
        await refreshUser(API_BASE);
        setStatus({
          kind: "ok",
          email: (data?.email as string | null) ?? null,
        });
      } catch {
        if (!cancelled) {
          setStatus({
            kind: "error",
            message: "Could not reach the server. Try again in a moment.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

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

      {status.kind === "loading" && (
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
