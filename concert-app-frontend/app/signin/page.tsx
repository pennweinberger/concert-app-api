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
    <div
      className="container-xs"
      style={{ paddingTop: "clamp(40px,8vw,96px)", paddingBottom: "80px" }}
    >
      <h1 className="h1" style={{ marginBottom: "32px" }}>
        Sign in
      </h1>

      <div className="field" style={{ marginBottom: "18px" }}>
        <label className="label" htmlFor="signin-handle">
          Handle
        </label>
        <input
          id="signin-handle"
          className="input"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="your_handle"
          autoComplete="username"
        />
      </div>

      <div className="field" style={{ marginBottom: "24px" }}>
        <label className="label" htmlFor="signin-password">
          Password
        </label>
        <input
          id="signin-password"
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          autoComplete="current-password"
        />
        <div style={{ textAlign: "right" }}>
          <Link
            href="/forgot-password"
            className="link"
            style={{ fontSize: "14px" }}
          >
            Forgot password?
          </Link>
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

      <button
        onClick={submit}
        disabled={submitting}
        className="btn btn-primary btn-lg btn-block"
        style={{ marginBottom: "24px" }}
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>

      <div
        style={{ color: "var(--muted)", fontSize: "15px", textAlign: "center" }}
      >
        No account?{" "}
        <Link href={`/signup?next=${encodeURIComponent(next)}`} className="link">
          Sign up
        </Link>
      </div>

      <div style={{ marginTop: "20px", textAlign: "center" }}>
        <Link href="/" className="link" style={{ fontSize: "15px" }}>
          ← Back to feed
        </Link>
      </div>
    </div>
  );
}

export default function SignInPage() {
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
        <SignInForm />
      </Suspense>
    </main>
  );
}
