"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authHeaders, getToken, useAuthUser } from "../../lib/auth";
import VerifyToPublishModal from "../../components/VerifyToPublishModal";
import { STAR_PATH } from "../../components/StarRating";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

/** Most rows to render in the search step. See the note at the list. */
const MAX_RESULTS = 20;

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
  const [manualState, setManualState] = useState("");
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
    const state = manualState.trim().toUpperCase();
    const localDate = manualDate.trim();

    if (!artist || !venue || !city || !state || !localDate) {
      // State is required here (unlike provider-sourced rows) because
      // market eligibility can't be judged from a city alone — "New York"
      // exists in several states.
      setManualError("Artist, venue, city, state and date are all required.");
      return;
    }
    if (!/^[A-Za-z]{2}$/.test(state)) {
      setManualError("Use a two-letter state code, e.g. NY or NJ.");
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
        body: JSON.stringify({ artist, venue, city, state, localDate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.showId) {
        setManualError(data?.error || "Couldn't add that show. Try again.");
        return;
      }
      // Out-of-market venue: the show and venue were saved, but reviewing
      // is refused while Afterset is NYC-only. Stop BEFORE the compose
      // step so no one writes a review that can't be published.
      if (data.marketEligible === false) {
        setManualError(
          `Afterset is New York City only right now. We've saved ${venue}, ${city} ${state} ` +
            `and will add it as we expand — your review will be possible once it's approved.`,
        );
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
        if (data.error === "out_of_market") {
          setError(
            data.message ||
              "Afterset is New York City only right now — this show's venue is outside our current market.",
          );
          return;
        }
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
    return <main className="page" />;
  }

  return (
    <main className="page">
      <VerifyToPublishModal
        open={showVerify}
        kind="review"
        onClose={() => setShowVerify(false)}
        onRetry={() => submit()}
        retrying={submitting}
      />
      <div
        className="container-sm"
        style={{ paddingTop: "20px", paddingBottom: "clamp(48px, 8vw, 96px)" }}
      >
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

        <h1 className="h1" style={{ margin: "16px 0 32px" }}>
          Write a review
        </h1>

        {/* Search step — visible when no show is selected */}
        {!selectedShow && (
          <>
            <div className="field">
              <label className="label" htmlFor="review-show-search">
                Step 1: Find the show
              </label>
              <div style={{ display: "flex", gap: "10px" }}>
                <input
                  id="review-show-search"
                  className="input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") runSearch();
                  }}
                  placeholder="Search by artist or show..."
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button
                  onClick={runSearch}
                  disabled={searching || !query.trim()}
                  className="btn btn-secondary"
                  style={{ height: "48px" }}
                >
                  {searching ? "Searching…" : "Search"}
                </button>
              </div>
            </div>

            {searched && results.length === 0 && !searching && (
              <div className="notice notice-info" style={{ marginTop: "16px" }}>
                No shows found for &ldquo;{query}&rdquo;.
              </div>
            )}

            {/* Bounded list. The backend now asks Ticketmaster for up to
                50 date-ordered events (it used to take a relevance-ordered
                20), which is right for coverage but far too many rows to
                render. DB rows come first and Ticketmaster rows are
                soonest-first, so the cut only ever drops far-future
                shows — and manual entry sits directly below for anything
                that isn't here. Styled like the ShowSearch dropdown, but
                in-flow rather than a popover. */}
            {results.length > 0 && (
              <div
                className="menu"
                style={{
                  position: "static",
                  marginTop: "16px",
                  padding: 6,
                  boxShadow: "var(--shadow-md)",
                }}
              >
                {results.slice(0, MAX_RESULTS).map((show) => (
                  <button
                    key={show.providerEventId}
                    onClick={() => selectShow(show)}
                    className="menu-item"
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: "15px",
                        letterSpacing: "-0.01em",
                        marginBottom: 2,
                      }}
                    >
                      {show.artist}
                    </div>
                    <div
                      style={{
                        color: "var(--muted)",
                        fontSize: "13.5px",
                        fontWeight: 400,
                      }}
                    >
                      {show.venue} · {show.city} · {show.localDate}
                    </div>
                  </button>
                ))}
              </div>
            )}

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
                className="link"
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  minHeight: "40px",
                  marginTop: "12px",
                  fontSize: "14.5px",
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                Can&rsquo;t find it? Add the show yourself
              </button>
            )}

            {manualOpen && (
              <div className="card card-outline" style={{ marginTop: "20px" }}>
                <h2 className="h3" style={{ fontSize: "19px" }}>
                  Add the show
                </h2>
                <p className="hint" style={{ margin: "6px 0 20px" }}>
                  We don&rsquo;t list every venue yet. Add the details and
                  we&rsquo;ll create it — if we already know the artist or
                  venue, yours joins the existing page.
                </p>

                <div className="stack" style={{ gap: "16px" }}>
                  {(
                    [
                      ["Artist", manualArtist, setManualArtist, "Hilary Duff"],
                      ["Venue", manualVenue, setManualVenue, "Madison Square Garden"],
                      ["City", manualCity, setManualCity, "New York"],
                      ["State", manualState, setManualState, "NY"],
                    ] as const
                  ).map(([label, value, setter, placeholder]) => (
                    <label key={label} className="field">
                      <span className="label">{label}</span>
                      <input
                        className="input"
                        value={value}
                        onChange={(e) => setter(e.target.value)}
                        placeholder={placeholder}
                        maxLength={label === "State" ? 2 : label === "City" ? 120 : 200}
                      />
                    </label>
                  ))}

                  <label className="field">
                    <span className="label">Date</span>
                    <input
                      type="date"
                      className="input"
                      value={manualDate}
                      onChange={(e) => setManualDate(e.target.value)}
                      // A review implies attendance, so future dates are
                      // never valid here. Enforced again on submit, since
                      // the max attribute alone is trivially bypassed.
                      max={todayLocalISO()}
                    />
                  </label>

                  {manualError && (
                    <div className="notice notice-error">{manualError}</div>
                  )}

                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    <button
                      onClick={submitManualShow}
                      disabled={manualSubmitting}
                      className="btn btn-primary"
                    >
                      {manualSubmitting ? "Adding…" : "Add and review"}
                    </button>
                    <button
                      onClick={() => {
                        setManualOpen(false);
                        setManualError(null);
                      }}
                      className="btn btn-ghost"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Compose step — visible once a show is selected */}
        {selectedShow && (
          <div className="stack" style={{ gap: "28px" }}>
            <div className="field">
              <div className="label">
                {preloadedShowId ? "Write your review" : "Step 2: Write your review"}
              </div>

              <div className="card card-outline" style={{ padding: "22px 24px" }}>
                <div className="eyebrow">Reviewing</div>
                <div
                  style={{
                    marginTop: "6px",
                    fontSize: "22px",
                    fontWeight: 700,
                    letterSpacing: "-0.03em",
                    lineHeight: 1.15,
                  }}
                >
                  {selectedShow.artist}
                </div>
                <div
                  style={{
                    marginTop: "4px",
                    fontSize: "15.5px",
                    fontWeight: 500,
                    color: "var(--ink-2)",
                  }}
                >
                  {selectedShow.venue} · {selectedShow.city}
                </div>
                <div className="meta" style={{ marginTop: "2px" }}>
                  {selectedShow.localDate}
                </div>
                <button
                  onClick={clearSelection}
                  className="link"
                  style={{
                    marginTop: "8px",
                    minHeight: "36px",
                    background: "none",
                    border: "none",
                    padding: 0,
                    fontFamily: "inherit",
                    fontSize: "14.5px",
                    cursor: "pointer",
                  }}
                >
                  Change show
                </button>
              </div>
            </div>

            <div className="field">
              <div className="label" id="review-rating-label">
                Rating
              </div>
              <div
                role="group"
                aria-labelledby="review-rating-label"
                style={{ display: "flex", gap: "2px", marginLeft: "-6px" }}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setRating(n)}
                    aria-label={`${n} star${n === 1 ? "" : "s"}`}
                    aria-pressed={n === rating}
                    style={{
                      width: "44px",
                      height: "44px",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "none",
                      border: "none",
                      borderRadius: "var(--radius-sm)",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    <svg
                      width="32"
                      height="32"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      style={{ display: "block" }}
                    >
                      <path
                        d={STAR_PATH}
                        fill={n <= rating ? "var(--ink)" : "var(--disabled)"}
                      />
                    </svg>
                  </button>
                ))}
              </div>
            </div>

            <textarea
              className="input"
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              placeholder="How was the show?"
              rows={6}
              style={{ minHeight: "180px" }}
            />

            {error && <div className="notice notice-error">{error}</div>}

            <div className="stack" style={{ gap: "12px" }}>
              {rating === 0 && reviewText.trim().length > 0 && (
                <div className="hint" style={{ textAlign: "center" }}>
                  No rating selected — your text won&rsquo;t be saved.
                </div>
              )}

              <button
                onClick={submit}
                disabled={submitting}
                className="btn btn-primary btn-lg btn-block"
              >
                {submitting
                  ? "Posting…"
                  : rating > 0
                    ? "Post Review"
                    : "Mark as Attended"}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
