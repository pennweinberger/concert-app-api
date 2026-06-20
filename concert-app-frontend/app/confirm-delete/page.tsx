"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { clearSession } from "../lib/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

// Same scanner-resistance discipline as verify-email and reset-password:
// do NOT auto-POST on mount. Require an explicit button click so email
// scanners (Outlook Safe Links / Defender, corporate firewalls) can't
// silently consume the one-shot deletion token.
type Status =
  | { kind: "ready" }
  | { kind: "submitting" }
  | { kind: "ok"; scheduledFor: string | null }
  | { kind: "error"; message: string };

function ConfirmDeleteInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>({ kind: "ready" });

  const missingToken = !token;

  async function confirm() {
    if (!token) return;
    setStatus({ kind: "submitting" });
    try {
      const res = await fetch(
        `${API_BASE}/auth/confirm-delete/${encodeURIComponent(token)}`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus({
          kind: "error",
          message:
            (data?.error as string | undefined) ||
            "This confirmation link is invalid or has expired.",
        });
        return;
      }
      // Confirmation succeeded. Clear the local session — the JWT is
      // technically still valid until expiry, but UX-wise the user
      // should appear logged out so they can revisit only via the
      // explicit "sign in to cancel" path during the grace period.
      clearSession();
      setStatus({
        kind: "ok",
        scheduledFor: (data?.deletionScheduledFor as string | null) ?? null,
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
          marginBottom: "16px",
          fontFamily: "var(--font-display), sans-serif",
          fontWeight: 700,
          letterSpacing: "-0.02em",
        }}
      >
        Confirm account deletion
      </h1>

      {missingToken && (
        <div
          style={{
            background: "#1f1f1f",
            padding: "12px",
            borderRadius: "12px",
            marginBottom: "16px",
            color: "#ff8080",
          }}
        >
          No confirmation token in the link. Use the link from your email.
        </div>
      )}

      {!missingToken && status.kind === "ready" && (
        <>
          <p style={{ color: "#aaa", marginBottom: "20px" }}>
            After you confirm, your account will be scheduled for deletion
            in 30 days. You can sign in during that time and cancel if
            you change your mind. Your reviews will remain on Afterset as
            archive records, attributed as <em>[deleted user]</em>.
          </p>
          <button
            onClick={confirm}
            style={{
              width: "100%",
              padding: "14px",
              borderRadius: "12px",
              border: "none",
              background: "#ff8080",
              color: "#0a0a0a",
              cursor: "pointer",
              fontWeight: "bold",
              marginBottom: "12px",
            }}
          >
            Confirm deletion
          </button>
          <div style={{ textAlign: "center", marginTop: "8px" }}>
            <Link
              href="/"
              style={{
                color: "#f4f1ea",
                fontSize: "14px",
                textDecoration: "underline",
                textUnderlineOffset: "3px",
              }}
            >
              Never mind — go home
            </Link>
          </div>
        </>
      )}

      {status.kind === "submitting" && (
        <div style={{ color: "#aaa" }}>Confirming…</div>
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
            Account deletion confirmed.
            {status.scheduledFor
              ? ` Scheduled to anonymize on ${new Date(status.scheduledFor).toLocaleDateString()}.`
              : ""}{" "}
            You can sign in during the grace period to cancel.
          </div>
          <Link
            href="/"
            style={{
              color: "#f4f1ea",
              fontSize: "14px",
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
          <Link
            href="/"
            style={{
              color: "#f4f1ea",
              fontSize: "14px",
              textDecoration: "underline",
              textUnderlineOffset: "3px",
            }}
          >
            ← Back to feed
          </Link>
        </>
      )}
    </div>
  );
}

export default function ConfirmDeletePage() {
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
        <ConfirmDeleteInner />
      </Suspense>
    </main>
  );
}
