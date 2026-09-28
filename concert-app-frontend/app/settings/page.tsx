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
    return <main className="page" />;
  }

  return (
    <main className="page">
      <div
        className="container-sm"
        style={{ paddingTop: "clamp(28px,4vw,48px)", paddingBottom: "80px" }}
      >
        <div style={{ marginBottom: "20px" }}>
          <Link
            href="/"
            className="link"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "2px",
              minHeight: "40px",
              fontSize: "15px",
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 5l-7 7 7 7" />
            </svg>
            Back to feed
          </Link>
        </div>

        <h1 className="h1" style={{ marginBottom: "32px" }}>
          Settings
        </h1>

        <section className="card card-outline">
          <h2 className="h3" style={{ marginBottom: "20px" }}>
            Edit profile
          </h2>

          {/* Live preview of the avatar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
              marginBottom: "24px",
              padding: "16px",
              background: "var(--surface)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <Avatar handle={authUser.handle} name={name} size={56} />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: "16px",
                  letterSpacing: "-0.01em",
                }}
              >
                {name.trim() || `@${authUser.handle}`}
              </div>
              <div className="meta">@{authUser.handle}</div>
            </div>
          </div>

          <div className="field" style={{ marginBottom: "24px" }}>
            <label className="label" htmlFor="settings-name">
              Display name
            </label>
            <input
              id="settings-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Optional"
              maxLength={50}
            />
            <div className="hint">
              Shown in place of @{authUser.handle}. Up to 50 characters.
            </div>
          </div>

          {error && (
            <div
              className="notice notice-error"
              role="alert"
              style={{ marginBottom: "16px" }}
            >
              {error}
            </div>
          )}
          {success && (
            <div
              className="notice notice-success"
              role="status"
              style={{ marginBottom: "16px" }}
            >
              {success}
            </div>
          )}

          <button
            onClick={save}
            disabled={submitting}
            className="btn btn-primary btn-lg btn-block"
          >
            {submitting ? "Saving…" : "Save"}
          </button>
        </section>

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
    <section className="card card-outline" style={{ marginTop: "24px" }}>
      <h2
        className="h3"
        style={{ color: "var(--danger)", marginBottom: "16px" }}
      >
        Danger zone
      </h2>

      {!expanded && requestState.kind === "idle" && (
        <button
          onClick={() => setExpanded(true)}
          className="btn btn-outline"
          style={{ color: "var(--danger)" }}
        >
          Delete account
        </button>
      )}

      {expanded && requestState.kind === "idle" && (
        <div className="notice notice-warning" style={{ padding: "16px" }}>
          <p style={{ margin: "0 0 16px", lineHeight: 1.5 }}>
            Are you sure? We will email you a confirmation link. After you
            click it, your account will be scheduled for deletion in 30
            days. Your reviews will remain on Afterset as archive records,
            attributed as <em>[deleted user]</em>.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
            <button
              onClick={requestDelete}
              disabled={submitting}
              className="btn btn-danger"
            >
              {submitting ? "Sending…" : "Send confirmation email"}
            </button>
            <button
              onClick={() => setExpanded(false)}
              disabled={submitting}
              className="btn btn-outline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {requestState.kind === "sent" && (
        <div className="notice notice-success" role="status">
          We sent a confirmation link to your email. Click it to schedule
          deletion (you can still cancel during the 30-day grace period).
        </div>
      )}

      {requestState.kind === "already_pending" && (
        <div className="notice notice-warning" role="status">
          Your account is already scheduled for deletion. See the banner
          at the top of the page to cancel.
        </div>
      )}

      {requestState.kind === "error" && (
        <div className="notice notice-error" role="alert">
          {requestState.message}
        </div>
      )}
    </section>
  );
}
