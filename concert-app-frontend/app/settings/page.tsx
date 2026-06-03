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
  const [avatarUrl, setAvatarUrl] = useState("");
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
        setAvatarUrl(data.avatarUrl ?? "");
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
          avatarUrl: avatarUrl.trim() === "" ? null : avatarUrl.trim(),
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
          background: "#0f0f0f",
          minHeight: "100vh",
          color: "white",
        }}
      />
    );
  }

  return (
    <main
      style={{
        background: "#0f0f0f",
        minHeight: "100vh",
        color: "white",
        padding: "24px",
      }}
    >
      <div style={{ maxWidth: "520px", margin: "0 auto" }}>
        <div style={{ marginBottom: "20px" }}>
          <Link href="/" style={{ color: "#7dafff" }}>
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
          <Avatar
            handle={authUser.handle}
            name={name}
            avatarUrl={avatarUrl}
            size={56}
          />
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
              color: "white",
              boxSizing: "border-box",
            }}
          />
          <div style={{ color: "#666", fontSize: "12px", marginTop: "6px" }}>
            Shown in place of @{authUser.handle}. Up to 50 characters.
          </div>
        </div>

        <div style={{ marginBottom: "24px" }}>
          <label
            style={{
              display: "block",
              color: "#aaa",
              marginBottom: "6px",
              fontSize: "14px",
            }}
          >
            Avatar URL
          </label>
          <input
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://… (optional)"
            maxLength={500}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: "10px",
              border: "1px solid #333",
              background: "#1a1a1a",
              color: "white",
              boxSizing: "border-box",
            }}
          />
          <div style={{ color: "#666", fontSize: "12px", marginTop: "6px" }}>
            Paste an http(s) URL to any image. Leave blank for the default
            initial avatar.
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
            background: submitting ? "#555" : "#22c55e",
            color: submitting ? "#aaa" : "white",
            cursor: submitting ? "not-allowed" : "pointer",
            fontWeight: "bold",
          }}
        >
          {submitting ? "Saving…" : "Save"}
        </button>
      </div>
    </main>
  );
}
