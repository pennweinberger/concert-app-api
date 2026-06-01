"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { setSession } from "../lib/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const cleanedHandle = handle.trim().replace(/^@/, "");
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(cleanedHandle)) {
      setError("Handle must be 3-20 chars: letters, numbers, underscore.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: cleanedHandle,
          password,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) {
          setError("That handle is already taken.");
        } else {
          setError(data?.error || `Sign up failed (HTTP ${res.status}).`);
        }
        setSubmitting(false);
        return;
      }

      const data = await res.json();
      if (!data?.token || !data?.user) {
        setError("Server did not return a valid session.");
        setSubmitting(false);
        return;
      }

      setSession(data.token, data.user);
      router.replace(next);
    } catch {
      setError("Network error. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: "420px", margin: "60px auto 0" }}>
      <h1 style={{ fontSize: "30px", marginBottom: "24px" }}>Sign up</h1>

      <div style={{ marginBottom: "14px" }}>
        <label
          style={{
            display: "block",
            color: "#aaa",
            marginBottom: "6px",
            fontSize: "14px",
          }}
        >
          Pick a handle
        </label>
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="your_handle"
          autoComplete="username"
          style={{
            width: "100%",
            padding: "14px",
            borderRadius: "12px",
            border: "1px solid #333",
            background: "#1a1a1a",
            color: "white",
            boxSizing: "border-box",
          }}
        />
        <div style={{ color: "#777", fontSize: "12px", marginTop: "6px" }}>
          3-20 chars: letters, numbers, underscore.
        </div>
      </div>

      <div style={{ marginBottom: "20px" }}>
        <label
          style={{
            display: "block",
            color: "#aaa",
            marginBottom: "6px",
            fontSize: "14px",
          }}
        >
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          autoComplete="new-password"
          style={{
            width: "100%",
            padding: "14px",
            borderRadius: "12px",
            border: "1px solid #333",
            background: "#1a1a1a",
            color: "white",
            boxSizing: "border-box",
          }}
        />
        <div style={{ color: "#777", fontSize: "12px", marginTop: "6px" }}>
          At least 8 characters.
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

      <button
        onClick={submit}
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
          marginBottom: "20px",
        }}
      >
        {submitting ? "Creating account…" : "Create account"}
      </button>

      <div style={{ color: "#aaa", fontSize: "14px", textAlign: "center" }}>
        Already have an account?{" "}
        <Link
          href={`/signin?next=${encodeURIComponent(next)}`}
          style={{ color: "#7dafff" }}
        >
          Sign in
        </Link>
      </div>

      <div style={{ marginTop: "20px", textAlign: "center" }}>
        <Link href="/" style={{ color: "#7dafff", fontSize: "14px" }}>
          ← Back to feed
        </Link>
      </div>
    </div>
  );
}

export default function SignUpPage() {
  return (
    <main
      style={{
        background: "#0f0f0f",
        minHeight: "100vh",
        color: "white",
        padding: "24px",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <Suspense fallback={<div style={{ color: "#aaa" }}>Loading…</div>}>
        <SignUpForm />
      </Suspense>
    </main>
  );
}
