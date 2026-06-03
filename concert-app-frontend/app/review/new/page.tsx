"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getToken, useAuthUser } from "../../lib/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type ShowSearchResult = {
  provider: string;
  providerEventId: string;
  artist: string;
  venue: string;
  city: string;
  localDate: string;
  ticketUrl: string;
};

export default function NewReviewPage() {
  const router = useRouter();

  // Auth gate: bounce to /signin if not signed in.
  // useAuthUser returns null during SSR / first render and the real value
  // after hydration; this effect fires once the value is known and
  // redirects when needed.
  const authUser = useAuthUser();
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!getToken()) {
      // Preserve the full current URL (including ?showId=… if present) so
      // a pre-filled review flow survives the signin round-trip.
      const here = "/review/new" + window.location.search;
      router.replace(`/signin?next=${encodeURIComponent(here)}`);
    }
  }, [authUser, router]);

  // Search step
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<ShowSearchResult[]>([]);

  // Compose step
  const [selectedShow, setSelectedShow] = useState<ShowSearchResult | null>(
    null,
  );
  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState("");

  // Pre-filled show flow: when we land here via /review/new?showId=X
  // (e.g. the CTA on a show page), we fetch the show, skip the search
  // step, and submit straight to /reviews using the known showId.
  const [preloadedShowId, setPreloadedShowId] = useState<string | null>(null);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill from ?showId=X. Reading window.location.search directly so
  // we don't need useSearchParams (which would require a Suspense
  // boundary around the page). Runs once on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const showIdParam = sp.get("showId");
    if (!showIdParam) return;

    let cancelled = false;
    async function loadShow() {
      try {
        const res = await fetch(`${API_BASE}/shows/${showIdParam}`);
        if (cancelled || !res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setSelectedShow({
          provider: "internal",
          providerEventId: data.id,
          artist: data.artist.name,
          venue: data.venue.name,
          city: data.venue.city,
          // /shows/:id returns ISO datetime; /shows/confirm expects YYYY-MM-DD.
          // Slicing here keeps the display + (fallback) confirm-call consistent
          // with the rest of the search flow.
          localDate: String(data.localDate).split("T")[0] ?? "",
          ticketUrl: "",
        });
        setPreloadedShowId(data.id);
      } catch {
        // Silent fallback to the search step. The user can search manually.
      }
    }
    loadShow();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/shows/search?q=${encodeURIComponent(query.trim())}`,
      );
      const data = await res.json();
      setResults(data.items || []);
      setSearched(true);
    } catch {
      setError("Search failed. Try again.");
    } finally {
      setSearching(false);
    }
  }

  function selectShow(show: ShowSearchResult) {
    setSelectedShow(show);
    // Don't clear results — user might want to "Change show" and revisit.
  }

  function clearSelection() {
    setSelectedShow(null);
    setRating(0);
    setReviewText("");
    setError(null);
    if (preloadedShowId) {
      setPreloadedShowId(null);
      // Drop the ?showId= param so a follow-up "Change show" search isn't
      // re-prefilled on re-mount.
      router.replace("/review/new");
    }
  }

  async function submitReview() {
    if (!selectedShow) return;
    if (rating < 1 || rating > 5) {
      setError("Pick a rating from 1 to 5 stars.");
      return;
    }
    if (!reviewText.trim()) {
      setError("Write something about the show.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // Step 1: get a showId. If we were pre-filled from a show page
      // (preloadedShowId set), skip /shows/confirm entirely — we already
      // know the row exists. Otherwise call confirm as before; it's
      // idempotent.
      let showId: string;
      if (preloadedShowId) {
        showId = preloadedShowId;
      } else {
        const confirmRes = await fetch(`${API_BASE}/shows/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            artist: selectedShow.artist,
            venue: selectedShow.venue,
            city: selectedShow.city,
            localDate: selectedShow.localDate,
          }),
        });

        if (!confirmRes.ok) {
          setError(`Could not confirm show (HTTP ${confirmRes.status}).`);
          setSubmitting(false);
          return;
        }

        const confirmData = await confirmRes.json();
        const sid: string | undefined = confirmData?.showId;
        if (!sid) {
          setError("Server did not return a showId.");
          setSubmitting(false);
          return;
        }
        showId = sid;
      }

      // Step 2: post the review (authed)
      const token = getToken();
      if (!token) {
        const here = "/review/new" + window.location.search;
        router.replace(`/signin?next=${encodeURIComponent(here)}`);
        return;
      }

      const reviewRes = await fetch(`${API_BASE}/reviews`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          showId,
          ratingOverall: rating,
          reviewTextRaw: reviewText.trim(),
        }),
      });

      if (reviewRes.status === 401) {
        // Token expired or invalid — bounce to sign in
        const here = "/review/new" + window.location.search;
        router.replace(`/signin?next=${encodeURIComponent(here)}`);
        return;
      }

      if (!reviewRes.ok) {
        setError(`Could not post review (HTTP ${reviewRes.status}).`);
        setSubmitting(false);
        return;
      }

      // Success → bounce to feed
      router.push("/");
    } catch {
      setError("Network error. Try again.");
      setSubmitting(false);
    }
  }

  // While the auth value hasn't resolved (SSR/first render) or the user
  // isn't signed in, render a blank shell so signed-out visitors don't see
  // the form flash before the bounce to /signin.
  if (!authUser) {
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
      <div style={{ maxWidth: "700px", margin: "0 auto" }}>
        <div style={{ marginBottom: "20px" }}>
          <Link href="/" style={{ color: "#7dafff" }}>
            ← Back to feed
          </Link>
        </div>

        <h1
          style={{
            fontSize: "30px",
            marginBottom: "24px",
            fontFamily: "var(--font-display), sans-serif",
            fontWeight: 700,
            letterSpacing: "-0.02em",
          }}
        >
          Write a review
        </h1>

        {/* Search step — visible when no show is selected */}
        {!selectedShow && (
          <>
            <div style={{ color: "#aaa", marginBottom: "12px" }}>
              Step 1: Find the show
            </div>

            <div
              style={{
                display: "flex",
                gap: "10px",
                marginBottom: "20px",
              }}
            >
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runSearch();
                }}
                placeholder="Search by artist or show..."
                style={{
                  flex: 1,
                  padding: "14px",
                  borderRadius: "12px",
                  border: "1px solid #333",
                  background: "#1a1a1a",
                  color: "white",
                }}
              />
              <button
                onClick={runSearch}
                disabled={searching || !query.trim()}
                style={{
                  padding: "14px 18px",
                  borderRadius: "12px",
                  border: "none",
                  background:
                    searching || !query.trim() ? "#555" : "white",
                  color:
                    searching || !query.trim() ? "#aaa" : "black",
                  fontWeight: "bold",
                  cursor:
                    searching || !query.trim() ? "not-allowed" : "pointer",
                }}
              >
                {searching ? "Searching…" : "Search"}
              </button>
            </div>

            {searched && results.length === 0 && !searching && (
              <div
                style={{
                  background: "#1a1a1a",
                  padding: "16px",
                  borderRadius: "12px",
                  color: "#aaa",
                }}
              >
                No shows found for &ldquo;{query}&rdquo;.
              </div>
            )}

            {results.map((show) => (
              <button
                key={show.providerEventId}
                onClick={() => selectShow(show)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  background: "#1a1a1a",
                  padding: "16px",
                  borderRadius: "14px",
                  border: "1px solid transparent",
                  marginBottom: "12px",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: "bold", fontSize: "16px" }}>
                  {show.artist}
                </div>
                <div style={{ color: "#bbb", marginTop: "4px" }}>
                  {show.venue} • {show.city}
                </div>
                <div style={{ color: "#777", marginTop: "4px" }}>
                  {show.localDate}
                </div>
              </button>
            ))}
          </>
        )}

        {/* Compose step — visible once a show is selected */}
        {selectedShow && (
          <>
            <div style={{ color: "#aaa", marginBottom: "12px" }}>
              {preloadedShowId ? "Write your review" : "Step 2: Write your review"}
            </div>

            <div
              style={{
                background: "#1a1a1a",
                padding: "16px",
                borderRadius: "14px",
                marginBottom: "20px",
                border: "1px solid #333",
              }}
            >
              <div style={{ fontSize: "12px", color: "#7dff9b" }}>
                Reviewing
              </div>
              <div
                style={{
                  fontWeight: "bold",
                  fontSize: "18px",
                  marginTop: "4px",
                }}
              >
                {selectedShow.artist}
              </div>
              <div style={{ color: "#bbb", marginTop: "4px" }}>
                {selectedShow.venue} • {selectedShow.city}
              </div>
              <div style={{ color: "#777", marginTop: "4px" }}>
                {selectedShow.localDate}
              </div>
              <button
                onClick={clearSelection}
                style={{
                  marginTop: "12px",
                  background: "none",
                  border: "none",
                  color: "#7dafff",
                  textDecoration: "underline",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: "14px",
                }}
              >
                Change show
              </button>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <div style={{ marginBottom: "8px", color: "#aaa" }}>Rating</div>
              <div style={{ display: "flex", gap: "6px" }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setRating(n)}
                    aria-label={`${n} star${n === 1 ? "" : "s"}`}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      fontSize: "32px",
                      color: n <= rating ? "#fbbf24" : "#444",
                      lineHeight: 1,
                    }}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>

            <textarea
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              placeholder="How was the show?"
              rows={6}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "10px",
                marginBottom: "16px",
                background: "#1a1a1a",
                color: "white",
                border: "1px solid #333",
                resize: "vertical",
                fontFamily: "inherit",
                fontSize: "15px",
                boxSizing: "border-box",
              }}
            />

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
              onClick={submitReview}
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
              {submitting ? "Posting…" : "Post Review"}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
