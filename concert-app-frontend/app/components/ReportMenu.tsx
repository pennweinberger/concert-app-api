"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken, authHeaders } from "../lib/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type TargetType = "REVIEW" | "COMMENT" | "USER";

const REASONS: { value: string; label: string }[] = [
  { value: "SPAM", label: "Spam" },
  { value: "HARASSMENT", label: "Harassment" },
  { value: "HATE_SPEECH", label: "Hate speech" },
  { value: "INAPPROPRIATE_CONTENT", label: "Inappropriate content" },
  { value: "FAKE_REVIEW", label: "Fake review" },
  { value: "IMPERSONATION", label: "Impersonation" },
  { value: "OTHER", label: "Other" },
];

/**
 * Discreet three-dot ("more") menu with a single "Report" action, opening a
 * small reason picker. Used on reviews, comments, and profiles. Kept
 * intentionally low-key — not a prominent button.
 */
export default function ReportMenu({
  targetType,
  targetId,
  reasonsAllowed,
}: {
  targetType: TargetType;
  targetId: string;
  /** Optionally restrict reasons (e.g. FAKE_REVIEW only makes sense for reviews). */
  reasonsAllowed?: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(false);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const reasons = reasonsAllowed
    ? REASONS.filter((r) => reasonsAllowed.includes(r.value))
    : REASONS;

  async function submit() {
    if (!reason) return;
    if (!getToken()) {
      router.push("/signin");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          targetType,
          targetId,
          reason,
          details: reason === "OTHER" ? details.trim() : undefined,
        }),
      });
      if (res.status === 401) {
        router.push("/signin");
        return;
      }
      if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.reason === "account_suspended"
            ? "Your account is suspended."
            : "Please verify your email first.",
        );
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        setError("Could not submit report.");
        setSubmitting(false);
        return;
      }
      setDone(true);
      setModal(false);
      setOpen(false);
    } catch {
      setError("Network error.");
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          color: "var(--success)",
          fontSize: "13px",
        }}
      >
        Reported
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        className="icon-btn"
        style={{ width: "36px", height: "36px", color: "var(--muted)" }}
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
          <circle cx="5" cy="12" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
        </svg>
      </button>

      {open && !modal && (
        <div
          className="menu"
          role="menu"
          style={{ right: 0, top: "40px", minWidth: "160px" }}
        >
          <button
            role="menuitem"
            onClick={() => setModal(true)}
            className="menu-item"
          >
            Report
          </button>
        </div>
      )}

      {modal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
          onClick={() => setModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`report-title-${targetId}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg)",
              borderRadius: "var(--radius-xl)",
              boxShadow: "var(--shadow-lg)",
              padding: "28px",
              width: "100%",
              maxWidth: "420px",
              boxSizing: "border-box",
              color: "var(--ink)",
              textAlign: "left",
            }}
          >
            <h2 id={`report-title-${targetId}`} className="h3" style={{ marginBottom: "18px" }}>
              Report {targetType.toLowerCase()}
            </h2>
            <div className="field" role="radiogroup" aria-label="Reason">
              {reasons.map((r) => (
                <label
                  key={r.value}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    minHeight: "32px",
                    fontSize: "15.5px",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    style={{ width: "18px", height: "18px", margin: 0, accentColor: "var(--ink)" }}
                  />
                  {r.label}
                </label>
              ))}
            </div>

            {reason === "OTHER" && (
              <div className="field" style={{ marginTop: "14px" }}>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="Add details (optional)"
                  aria-label="Details"
                  rows={3}
                  className="input"
                  style={{ minHeight: "96px" }}
                />
              </div>
            )}

            {error && (
              <div className="notice notice-error" style={{ marginTop: "14px" }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: "10px", marginTop: "24px", justifyContent: "flex-end" }}>
              <button onClick={() => setModal(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!reason || submitting}
                className="btn btn-primary"
              >
                {submitting ? "Submitting…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
