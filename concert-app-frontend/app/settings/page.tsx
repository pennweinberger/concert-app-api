"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getToken, useAuthUser } from "../lib/auth";
import Avatar from "../components/Avatar";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

export default function SettingsPage() {
  const router = useRouter();
  const authUser = useAuthUser();

  // Auth gate
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!getToken()) {
      router.replace(`/signin?next=${encodeURIComponent("/settings")}`);
    }
  }, [authUser, router]);

  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Load current profile values on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!authUser) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/users/${authUser!.handle}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setName(data.name ?? "");
        setLoaded(true);
      } catch {
        // Best-effort prefill; user can still type values in.
        if (!cancelled) setLoaded(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [authUser]);

  async function save() {
    const token = getToken();
    if (!token) return;

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API_BASE}/users/me`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim() === "" ? null : name.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || `Save failed (HTTP ${res.status}).`);
        setSubmitting(false);
        return;
      }
      setSuccess("Saved.");
      setSubmitting(false);
    } catch {
      setError("Network error. Try again.");
      setSubmitting(false);
    }
  }

  // Render nothing until we know whether the user is signed in (avoids
  // a flash of the form before the auth redirect fires).
  if (!authUser || !loaded) {
    return (
      <main
        style={{
          background: "#0a0a0a",
          minHeight: "100vh",
          color: "#f4f1ea",
        }}
      />
    );
  }

  return (
    <main
      style={{
        background: "#0a0a0a",
        minHeight: "100vh",
        color: "#f4f1ea",
        padding: "24px",
      }}
    >
      <div style={{ maxWidth: "520px", margin: "0 auto" }}>
        <div style={{ marginBottom: "20px" }}>
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

        <h1
          style={{
            fontSize: "28px",
            marginBottom: "20px",
            fontFamily: "var(--font-display), sans-serif",
            fontWeight: 700,
            letterSpacing: "-0.02em",
          }}
        >
          Edit profile
        </h1>

        {/* Live preview of the avatar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            marginBottom: "24px",
            padding: "14px",
            background: "#1a1a1a",
            borderRadius: "14px",
          }}
        >
          <Avatar handle={authUser.handle} name={name} size={56} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: "bold", fontSize: "16px" }}>
              {name.trim() || `@${authUser.handle}`}
            </div>
            <div style={{ color: "#888", fontSize: "13px" }}>
              @{authUser.handle}
            </div>
          </div>
        </div>

        <div style={{ marginBottom: "16px" }}>
          <label
            style={{
              display: "block",
              color: "#aaa",
              marginBottom: "6px",
              fontSize: "14px",
            }}
          >
            Display name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Optional"
            maxLength={50}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: "10px",
              border: "1px solid #333",
              background: "#1a1a1a",
              color: "#f4f1ea",
              boxSizing: "border-box",
            }}
          />
          <div style={{ color: "#666", fontSize: "12px", marginTop: "6px" }}>
            Shown in place of @{authUser.handle}. Up to 50 characters.
          </div>
        </div>

        {error && (
          <div
            style={{
              background: "#1f1f1f",
              padding: "12px",
              borderRadius: "12px",
              marginBottom: "16px",
              color: "#ff8080",
            }}
          >
            {error}
          </div>
        )}
        {success && (
          <div
            style={{
              background: "#1f1f1f",
              padding: "12px",
              borderRadius: "12px",
              marginBottom: "16px",
              color: "#7dff9b",
            }}
          >
            {success}
          </div>
        )}

        <button
          onClick={save}
          disabled={submitting}
          style={{
            width: "100%",
            padding: "14px",
            borderRadius: "12px",
            border: "none",
            background: submitting ? "#555" : "#f4f1ea",
            color: submitting ? "#aaa" : "#0a0a0a",
            cursor: submitting ? "not-allowed" : "pointer",
            fontWeight: "bold",
          }}
        >
          {submitting ? "Saving…" : "Save"}
        </button>

        <DangerZone />
      </div>
    </main>
  );
}

// Account-deletion entry point. Two-step: an initial button reveals the
// "are you sure" confirmation, which posts to /auth/request-delete and
// shows the "check your email" message. The actual deletion only takes
// effect after the user opens the email and clicks through the
// /confirm-delete page.
function DangerZone() {
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [requestState, setRequestState] = useState<
    | { kind: "idle" }
    | { kind: "sent" }
    | { kind: "error"; message: string }
    | { kind: "already_pending" }
  >({ kind: "idle" });

  async function requestDelete() {
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/auth/request-delete`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setRequestState({ kind: "sent" });
      } else if (res.status === 409) {
        setRequestState({ kind: "already_pending" });
      } else {
        setRequestState({
          kind: "error",
          message:
            (data?.error as string | undefined) ??
            "Could not start account deletion.",
        });
      }
    } catch {
      setRequestState({
        kind: "error",
        message: "Could not reach the server.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        marginTop: "48px",
        paddingTop: "24px",
        borderTop: "1px solid #2a1f1f",
      }}
    >
      <h2
        style={{
          fontSize: "16px",
          color: "#ff8080",
          marginBottom: "12px",
        }}
      >
        Danger zone
      </h2>

      {!expanded && requestState.kind === "idle" && (
        <button
          onClick={() => setExpanded(true)}
          style={{
            background: "transparent",
            border: "1px solid #ff8080",
            color: "#ff8080",
            padding: "10px 16px",
            borderRadius: "12px",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          Delete account
        </button>
      )}

      {expanded && requestState.kind === "idle" && (
        <div
          style={{
            background: "#1f1f1f",
            padding: "16px",
            borderRadius: "12px",
            border: "1px solid #3a1f1f",
          }}
        >
          <p
            style={{
              color: "#f4f1ea",
              fontSize: "14px",
              marginBottom: "12px",
              lineHeight: 1.5,
            }}
          >
            Are you sure? We will email you a confirmation link. After you
            click it, your account will be scheduled for deletion in 30
            days. Your reviews will remain on Afterset as archive records,
            attributed as <em>[deleted user]</em>.
          </p>
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              onClick={requestDelete}
              disabled={submitting}
              style={{
                background: submitting ? "#555" : "#ff8080",
                border: "none",
                color: "#0a0a0a",
                padding: "10px 16px",
                borderRadius: "12px",
                cursor: submitting ? "not-allowed" : "pointer",
                fontSize: "14px",
                fontWeight: "bold",
              }}
            >
              {submitting ? "Sending…" : "Send confirmation email"}
            </button>
            <button
              onClick={() => setExpanded(false)}
              disabled={submitting}
              style={{
                background: "transparent",
                border: "1px solid #555",
                color: "#aaa",
                padding: "10px 16px",
                borderRadius: "12px",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {requestState.kind === "sent" && (
        <div
          style={{
            background: "#1f1f1f",
            padding: "12px",
            borderRadius: "12px",
            color: "#9be597",
            fontSize: "14px",
          }}
        >
          We sent a confirmation link to your email. Click it to schedule
          deletion (you can still cancel during the 30-day grace period).
        </div>
      )}

      {requestState.kind === "already_pending" && (
        <div
          style={{
            background: "#1f1f1f",
            padding: "12px",
            borderRadius: "12px",
            color: "#f4d27d",
            fontSize: "14px",
          }}
        >
          Your account is already scheduled for deletion. See the banner
          at the top of the page to cancel.
        </div>
      )}

      {requestState.kind === "error" && (
        <div
          style={{
            background: "#1f1f1f",
            padding: "12px",
            borderRadius: "12px",
            color: "#ff8080",
            fontSize: "14px",
          }}
        >
          {requestState.message}
        </div>
      )}
    </div>
  );
}
