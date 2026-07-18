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
 * Discreet three-dot (⋯) menu with a single "Report" action, opening a
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
      <span style={{ color: "#7dff9b", fontSize: "12px" }}>Reported ✓</span>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="More options"
        style={{
          background: "none",
          border: "none",
          color: "#777",
          cursor: "pointer",
          fontSize: "18px",
          lineHeight: 1,
          padding: "2px 6px",
        }}
      >
        ⋯
      </button>

      {open && !modal && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "24px",
            background: "#1a1a1a",
            border: "1px solid #333",
            borderRadius: "8px",
            zIndex: 20,
            minWidth: "120px",
          }}
        >
          <button
            onClick={() => setModal(true)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              background: "none",
              border: "none",
              color: "#f4f1ea",
              cursor: "pointer",
              padding: "10px 14px",
              fontSize: "14px",
            }}
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
            background: "rgba(0,0,0,0.6)",
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
          onClick={() => setModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#141414",
              border: "1px solid #333",
              borderRadius: "14px",
              padding: "20px",
              width: "100%",
              maxWidth: "400px",
              color: "#f4f1ea",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: "17px", marginBottom: "14px" }}>
              Report {targetType.toLowerCase()}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {reasons.map((r) => (
                <label
                  key={r.value}
                  style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                  />
                  {r.label}
                </label>
              ))}
            </div>

            {reason === "OTHER" && (
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Add details (optional)"
                rows={3}
                style={{
                  width: "100%",
                  marginTop: "12px",
                  padding: "10px",
                  borderRadius: "8px",
                  background: "#1a1a1a",
                  color: "#f4f1ea",
                  border: "1px solid #333",
                  resize: "vertical",
                  fontFamily: "inherit",
                  boxSizing: "border-box",
                }}
              />
            )}

            {error && (
              <div style={{ color: "#ff8080", marginTop: "10px", fontSize: "13px" }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: "10px", marginTop: "16px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setModal(false)}
                style={{
                  background: "none",
                  border: "1px solid #333",
                  color: "#aaa",
                  borderRadius: "8px",
                  padding: "8px 14px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!reason || submitting}
                style={{
                  background: !reason || submitting ? "#555" : "#f4f1ea",
                  color: !reason || submitting ? "#aaa" : "#0a0a0a",
                  border: "none",
                  borderRadius: "8px",
                  padding: "8px 14px",
                  fontWeight: "bold",
                  cursor: !reason || submitting ? "not-allowed" : "pointer",
                }}
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
