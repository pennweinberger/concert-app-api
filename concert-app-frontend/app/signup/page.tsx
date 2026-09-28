"use client";

import { Suspense, useState } from "react";
import TurnstileWidget from "../components/TurnstileWidget";
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Turnstile token. Stays null when Cloudflare isn't configured or the
  // widget failed to load; the server fails open in both cases, so we
  // never block submission on it client-side.
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  async function submit() {
    const cleanedHandle = handle.trim().replace(/^@/, "");
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(cleanedHandle)) {
      setError("Handle must be 3-20 chars: letters, numbers, underscore.");
      return;
    }
    const cleanedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedEmail)) {
      setError("Enter a valid email address.");
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
          email: cleanedEmail,
          password,
          ...(turnstileToken ? { turnstileToken } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === "captcha_failed") {
          setError(
            data.message || "Please complete the verification and try again.",
          );
          return;
        }
        if (res.status === 409) {
          const msg = (data?.error as string | undefined) ?? "";
          if (msg.toLowerCase().includes("email")) {
            setError("That email is already in use. Sign in instead?");
          } else {
            setError(
              "That handle is already taken. If it's yours, sign in instead.",
            );
          }
        } else {
          setError(
            data?.error || "Sign up failed. Try again in a moment.",
          );
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
        Sign up
      </h1>

      <div className="field" style={{ marginBottom: "18px" }}>
        <label className="label" htmlFor="signup-handle">
          Pick a handle
        </label>
        <input
          id="signup-handle"
          className="input"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="your_handle"
          autoComplete="username"
        />
        <div className="hint">3-20 chars: letters, numbers, underscore.</div>
      </div>

      <div className="field" style={{ marginBottom: "18px" }}>
        <label className="label" htmlFor="signup-email">
          Email
        </label>
        <input
          id="signup-email"
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="you@example.com"
          autoComplete="email"
        />
        <div className="hint">
          We send a verification link. Used for password reset later.
        </div>
      </div>

      <div className="field" style={{ marginBottom: "24px" }}>
        <label className="label" htmlFor="signup-password">
          Password
        </label>
        <input
          id="signup-password"
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          autoComplete="new-password"
        />
        <div className="hint">At least 8 characters.</div>
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

      <TurnstileWidget onToken={setTurnstileToken} />
      <button
        onClick={submit}
        disabled={submitting}
        className="btn btn-primary btn-lg btn-block"
        style={{ marginBottom: "24px" }}
      >
        {submitting ? "Creating account…" : "Create account"}
      </button>

      <div
        style={{ color: "var(--muted)", fontSize: "15px", textAlign: "center" }}
      >
        Already have an account?{" "}
        <Link href={`/signin?next=${encodeURIComponent(next)}`} className="link">
          Sign in
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

export default function SignUpPage() {
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
        <SignUpForm />
      </Suspense>
    </main>
  );
}
