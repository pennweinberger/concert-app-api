"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authHeaders, getToken, useAuthUser } from "../../lib/auth";
import VerifyToPublishModal from "../../components/VerifyToPublishModal";

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

  // Manual entry. Ingestion covers a fixed venue allowlist, and
  // Ticketmaster returns nothing for events that have already happened —
  // so for a gig at an un-ingested venue this is the ONLY way in. Without
  // it the search step is a dead end for exactly the shows people most
  // want to review: the ones they just went to.
  const [manualOpen, setManualOpen] = useState(false);
  const [manualArtist, setManualArtist] = useState("");
  const [manualVenue, setManualVenue] = useState("");
  const [manualCity, setManualCity] = useState("");
  const [manualDate, setManualDate] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSubmitting, setManualSubmitting] = useState(false);

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
  const [showVerify, setShowVerify] = useState(false);

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
      const trimmed = query.trim();
      // Parallel fetch: internal DB (DICE / TM-confirmed / etc.) + live
      // Ticketmaster. DB rows are authoritative — list them first and
      // suppress any TM duplicates by (artist|venue|city|date).
      //
      // FUTURE CLEANUP: this parallel-fetch + merge + dedupe pattern is
      // duplicated from app/components/ShowSearch.tsx. Extract a shared
      // useShowSearch hook in app/lib/ next time we touch either file
      // (see [[future-cleanup]] memory entry).
      const [dbRes, tmRes] = await Promise.all([
        fetch(`${API_BASE}/shows?q=${encodeURIComponent(trimmed)}&limit=20`),
        fetch(`${API_BASE}/shows/search?q=${encodeURIComponent(trimmed)}`),
      ]);
      const dbData = dbRes.ok ? await dbRes.json() : { items: [] };
      const tmData = tmRes.ok ? await tmRes.json() : { items: [] };

      const dbItems: ShowSearchResult[] = (dbData.items ?? []).map(
        (i: any) => ({
          provider: "internal",
          providerEventId: i.id,
          artist: i.artist?.name ?? "",
          venue: i.venue?.name ?? "",
          city: i.venue?.city ?? "",
          // /shows?q= returns ISO datetime; the rest of this flow expects
          // YYYY-MM-DD. Slice to match the ?showId= preload path above.
          localDate: String(i.localDate ?? "").split("T")[0] ?? "",
          ticketUrl: "",
        }),
      );
      const tmItems: ShowSearchResult[] = (tmData.items ?? []).filter(
        (i: any) =>
          typeof i.artist === "string" &&
          typeof i.venue === "string" &&
          typeof i.localDate === "string",
      );

      const dedupeKey = (r: ShowSearchResult) =>
        [r.artist, r.venue, r.city, r.localDate].join("|").toLowerCase();
      const dbKeys = new Set(dbItems.map(dedupeKey));
      const filteredTm = tmItems.filter((t) => !dbKeys.has(dedupeKey(t)));

      setResults([...dbItems, ...filteredTm]);
      setSearched(true);
    } catch {
      setError("Search failed. Try again.");
    } finally {
      setSearching(false);
    }
  }

  /** Today in the user's own timezone — the max reviewable date. */
  function todayLocalISO(): string {
    const d = new Date();
    const off = d.getTimezoneOffset() * 60_000;
    return new Date(d.getTime() - off).toISOString().slice(0, 10);
  }

  async function submitManualShow() {
    const artist = manualArtist.trim();
    const venue = manualVenue.trim();
    const city = manualCity.trim();
    const localDate = manualDate.trim();

    if (!artist || !venue || !city || !localDate) {
      setManualError("Artist, venue, city and date are all required.");
      return;
    }
    // A review implies you were there, so a future date is never valid.
    if (localDate > todayLocalISO()) {
      setManualError("That date is in the future — you can only review a show you've been to.");
      return;
    }

    setManualSubmitting(true);
    setManualError(null);
    try {
      // /shows/confirm resolves Artist by unique name and Venue by unique
      // (name, city), so typing a venue we already know attaches to the
      // existing row instead of creating a duplicate.
      const res = await fetch(`${API_BASE}/shows/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ artist, venue, city, localDate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.showId) {
        setManualError(data?.error || "Couldn't add that show. Try again.");
        return;
      }
      // Straight into the compose step, same as picking a search result.
      setPreloadedShowId(data.showId);
      setSelectedShow({
        provider: "internal",
        providerEventId: data.showId,
        artist,
        venue,
        city,
        localDate,
        ticketUrl: "",
      });
    } catch {
      setManualError("Network error. Try again.");
    } finally {
      setManualSubmitting(false);
    }
  }

  function selectShow(show: ShowSearchResult) {
    setSelectedShow(show);
    // DB-sourced rows already exist as a Show — skip the round-trip
    // through /shows/confirm by setting preloadedShowId, which the
    // submit() path branches on at line ~148. Mirrors the ?showId=
    // preload behavior at the top of this file.
    if (show.provider === "internal") {
      setPreloadedShowId(show.providerEventId);
    }
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

  async function submit() {
    if (!selectedShow) return;

    // Branch on whether the user gave a rating:
    //   rating > 0  -> POST /reviews (text optional; empty is fine)
    //   rating == 0 -> POST /shows/:id/attend (text discarded)
    const wantsReview = rating > 0;

    setSubmitting(true);
    setError(null);

    try {
      // Step 1: resolve a showId. Preloaded -> use directly. Otherwise
      // call the idempotent /shows/confirm to create-or-fetch.
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

      const token = getToken();
      if (!token) {
        const here = "/review/new" + window.location.search;
        router.replace(`/signin?next=${encodeURIComponent(here)}`);
        return;
      }

      // Step 2: post — either a review (with optional text) or just
      // attendance.
      const res = wantsReview
        ? await fetch(`${API_BASE}/reviews`, {
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
          })
        : await fetch(`${API_BASE}/shows/${showId}/attend`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          });

      if (res.status === 401) {
        const here = "/review/new" + window.location.search;
        router.replace(`/signin?next=${encodeURIComponent(here)}`);
        return;
      }

      if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        if (data.reason === "email_not_verified") {
          // Everything they wrote (selectedShow, rating, reviewText) stays
          // in state — show the verify nudge and let them retry.
          setShowVerify(true);
          setSubmitting(false);
          return;
        }
        setError(
          data.reason === "account_suspended"
            ? "Your account is suspended."
            : `Could not post review (HTTP ${res.status}).`,
        );
        setSubmitting(false);
        return;
      }

      if (!res.ok) {
        setError(
          wantsReview
            ? `Could not post review (HTTP ${res.status}).`
            : `Could not mark attendance (HTTP ${res.status}).`,
        );
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
      <VerifyToPublishModal
        open={showVerify}
        kind="review"
        onClose={() => setShowVerify(false)}
        onRetry={() => submit()}
        retrying={submitting}
      />
      <div style={{ maxWidth: "700px", margin: "0 auto" }}>
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
                  color: "#f4f1ea",
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
                    searching || !query.trim() ? "#555" : "#f4f1ea",
                  color:
                    searching || !query.trim() ? "#aaa" : "#0a0a0a",
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
                  color: "#f4f1ea",
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

            {/* Manual entry. Offered once a search has run — including when
                it DID return results, since the right show may simply not
                be among them (a venue outside the ingest allowlist, or a
                past date Ticketmaster no longer returns). */}
            {searched && !searching && !manualOpen && (
              <button
                onClick={() => {
                  setManualOpen(true);
                  setManualArtist(query.trim());
                  setManualError(null);
                }}
                style={{
                  background: "none",
                  border: "none",
                  padding: "4px 0",
                  marginTop: results.length ? "6px" : "14px",
                  color: "#8a8a8a",
                  fontSize: "13.5px",
                  fontFamily: "inherit",
                  cursor: "pointer",
                  textDecoration: "underline",
                  textUnderlineOffset: "3px",
                }}
              >
                Can&rsquo;t find it? Add the show yourself
              </button>
            )}

            {manualOpen && (
              <div
                style={{
                  marginTop: "16px",
                  padding: "16px",
                  borderRadius: "14px",
                  border: "1px solid rgba(226,140,60,0.45)",
                  background:
                    "linear-gradient(100deg, rgba(120,40,90,0.22), rgba(60,20,80,0.16))",
                }}
              >
                <div
                  style={{
                    fontSize: "15px",
                    fontWeight: 600,
                    marginBottom: "4px",
                  }}
                >
                  Add the show
                </div>
                <div
                  style={{
                    fontSize: "13px",
                    color: "#a9a295",
                    marginBottom: "14px",
                    lineHeight: 1.5,
                  }}
                >
                  We don&rsquo;t list every venue yet. Add the details and
                  we&rsquo;ll create it — if we already know the artist or
                  venue, yours joins the existing page.
                </div>

                {(
                  [
                    ["Artist", manualArtist, setManualArtist, "Hilary Duff"],
                    ["Venue", manualVenue, setManualVenue, "Madison Square Garden"],
                    ["City", manualCity, setManualCity, "New York"],
                  ] as const
                ).map(([label, value, setter, placeholder]) => (
                  <label key={label} style={{ display: "block", marginBottom: "10px" }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: "12.5px",
                        color: "#8a8a8a",
                        marginBottom: "4px",
                      }}
                    >
                      {label}
                    </span>
                    <input
                      value={value}
                      onChange={(e) => setter(e.target.value)}
                      placeholder={placeholder}
                      maxLength={label === "City" ? 120 : 200}
                      style={{
                        width: "100%",
                        padding: "11px 12px",
                        borderRadius: "10px",
                        border: "1px solid #333",
                        background: "#141414",
                        color: "#f4f1ea",
                        fontSize: "14.5px",
                        fontFamily: "inherit",
                        boxSizing: "border-box",
                      }}
                    />
                  </label>
                ))}

                <label style={{ display: "block", marginBottom: "14px" }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: "12.5px",
                      color: "#8a8a8a",
                      marginBottom: "4px",
                    }}
                  >
                    Date
                  </span>
                  <input
                    type="date"
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                    // A review implies attendance, so future dates are
                    // never valid here. Enforced again on submit, since
                    // the max attribute alone is trivially bypassed.
                    max={todayLocalISO()}
                    style={{
                      width: "100%",
                      padding: "11px 12px",
                      borderRadius: "10px",
                      border: "1px solid #333",
                      background: "#141414",
                      color: "#f4f1ea",
                      fontSize: "14.5px",
                      fontFamily: "inherit",
                      boxSizing: "border-box",
                    }}
                  />
                </label>

                {manualError && (
                  <div
                    style={{
                      color: "#ff8080",
                      fontSize: "13px",
                      marginBottom: "10px",
                      lineHeight: 1.5,
                    }}
                  >
                    {manualError}
                  </div>
                )}

                <div style={{ display: "flex", gap: "10px" }}>
                  <button
                    onClick={submitManualShow}
                    disabled={manualSubmitting}
                    style={{
                      padding: "10px 16px",
                      borderRadius: "10px",
                      border: "none",
                      background: manualSubmitting ? "#555" : "#e0219b",
                      color: manualSubmitting ? "#aaa" : "#fff",
                      fontSize: "13.5px",
                      fontWeight: 600,
                      fontFamily: "inherit",
                      cursor: manualSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {manualSubmitting ? "Adding…" : "Add and review"}
                  </button>
                  <button
                    onClick={() => {
                      setManualOpen(false);
                      setManualError(null);
                    }}
                    style={{
                      padding: "10px 16px",
                      borderRadius: "10px",
                      border: "1px solid #333",
                      background: "none",
                      color: "#aaa",
                      fontSize: "13.5px",
                      fontFamily: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
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
                  color: "#f4f1ea",
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
                color: "#f4f1ea",
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

            {rating === 0 && reviewText.trim().length > 0 && (
              <div
                style={{
                  color: "#888",
                  fontSize: "12px",
                  marginBottom: "10px",
                  textAlign: "center",
                }}
              >
                No rating selected — your text won&rsquo;t be saved.
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
              }}
            >
              {submitting
                ? "Posting…"
                : rating > 0
                  ? "Post Review"
                  : "Mark as Attended"}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
