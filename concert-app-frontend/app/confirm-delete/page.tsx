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
    <div
      className="container-xs"
      style={{ paddingTop: "clamp(40px,8vw,96px)", paddingBottom: "80px" }}
    >
      <h1 className="h1" style={{ marginBottom: "20px" }}>
        Confirm account deletion
      </h1>

      {missingToken && (
        <div
          className="notice notice-error"
          role="alert"
          style={{ marginBottom: "16px" }}
        >
          No confirmation token in the link. Use the link from your email.
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
            After you confirm, your account will be scheduled for deletion
            in 30 days. You can sign in during that time and cancel if
            you change your mind. Your reviews will remain on Afterset as
            archive records, attributed as <em>[deleted user]</em>.
          </p>
          <button
            onClick={confirm}
            className="btn btn-danger btn-lg btn-block"
            style={{ marginBottom: "12px" }}
          >
            Confirm deletion
          </button>
          <div style={{ textAlign: "center", marginTop: "12px" }}>
            <Link href="/" className="link" style={{ fontSize: "15px" }}>
              Never mind — go home
            </Link>
          </div>
        </>
      )}

      {status.kind === "submitting" && (
        <div className="meta" role="status">
          Confirming…
        </div>
      )}

      {status.kind === "ok" && (
        <>
          <div
            className="notice notice-success"
            role="status"
            style={{ marginBottom: "16px" }}
          >
            Account deletion confirmed.
            {status.scheduledFor
              ? ` Scheduled to anonymize on ${new Date(status.scheduledFor).toLocaleDateString()}.`
              : ""}{" "}
            You can sign in during the grace period to cancel.
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
          <Link href="/" className="link" style={{ fontSize: "15px" }}>
            ← Back to feed
          </Link>
        </>
      )}
    </div>
  );
}

export default function ConfirmDeletePage() {
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
        <ConfirmDeleteInner />
      </Suspense>
    </main>
  );
}
