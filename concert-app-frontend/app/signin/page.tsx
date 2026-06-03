"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { setSession } from "../lib/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!handle.trim() || !password) {
      setError("Handle and password required.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: handle.trim(),
          password,
        }),
      });

      if (!res.ok) {
        if (res.status === 401) {
          setError("Invalid handle or password.");
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data?.error || "Sign in failed. Try again in a moment.");
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
      <h1
        style={{
          fontSize: "30px",
          marginBottom: "24px",
          fontFamily: "var(--font-display), sans-serif",
          fontWeight: 700,
          letterSpacing: "-0.02em",
        }}
      >
        Sign in
      </h1>

      <div style={{ marginBottom: "14px" }}>
        <label
          style={{
            display: "block",
            color: "#aaa",
            marginBottom: "6px",
            fontSize: "14px",
          }}
        >
          Handle
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
          autoComplete="current-password"
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
          background: submitting ? "#555" : "#f4f1ea",
          color: submitting ? "#aaa" : "#0a0a0a",
          cursor: submitting ? "not-allowed" : "pointer",
          fontWeight: "bold",
          marginBottom: "20px",
        }}
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>

      <div style={{ color: "#aaa", fontSize: "14px", textAlign: "center" }}>
        No account?{" "}
        <Link
          href={`/signup?next=${encodeURIComponent(next)}`}
          style={{
            color: "#f4f1ea",
            textDecoration: "underline",
            textUnderlineOffset: "3px",
          }}
        >
          Sign up
        </Link>
      </div>

      <div style={{ marginTop: "20px", textAlign: "center" }}>
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
      </div>
    </div>
  );
}

export default function SignInPage() {
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
        <SignInForm />
      </Suspense>
    </main>
  );
}
