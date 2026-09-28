"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authHeaders, useAuthUser } from "./lib/auth";
import ShowSearch from "./components/ShowSearch";
import ReviewCard from "./components/ReviewCard";
import LoadMore from "./components/LoadMore";
import WriteReviewHero from "./components/WriteReviewHero";
import SegmentedTabs from "./components/SegmentedTabs";
import { formatShowDate } from "./lib/dateFormat";

type FeedScope = "all" | "following";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

type FeedShow = {
  id: string;
  localDate: string;
  artistId: string;
  artist: string;
  venue: string;
  city: string;
};

// Discriminated union: review entries are the full editorial card;
// attendance entries are lighter activity rows that only appear on the
// Following tab when the user has attended but not reviewed.
type FeedItem =
  | {
      type: "review";
      reviewId: string;
      userHandle: string;
      userName: string | null;
      ratingOverall: number;
      reviewTextRaw: string;
      publishedAt: string;
      likeCount: number;
      commentCount: number;
      liked: boolean;
      show: FeedShow;
    }
  | {
      type: "attendance";
      attendanceId: string;
      userHandle: string;
      userName: string | null;
      attendedAt: string;
      show: FeedShow;
    };

const PAGE_SIZE = 20;

/** Stable identity for a feed item, used to drop duplicates on append. */
function feedKey(item: FeedItem): string {
  return item.type === "review"
    ? `r:${item.reviewId}`
    : `a:${item.attendanceId}`;
}

export default function Home() {
  const router = useRouter();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<FeedScope>("all");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const authUser = useAuthUser();

  // Read ?scope= from URL on mount so the toggle is bookmarkable
  // and survives refresh. Falls back to "all" if no/unknown scope.
  // Deferred to a microtask so setState isn't synchronous within the
  // effect body (matches the async-load pattern used elsewhere and
  // keeps react-hooks/set-state-in-effect happy).
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      const sp = new URLSearchParams(window.location.search);
      if (sp.get("scope") === "following") setScope("following");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function selectScope(next: FeedScope) {
    if (next === scope) return;
    setScope(next);
    // Reflect in URL for shareable links / refresh persistence.
    const path = next === "following" ? "/?scope=following" : "/";
    router.replace(path);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setMoreError(null);
      try {
        const scopeParam =
          scope === "following" ? "scope=following&" : "";
        const res = await fetch(
          `${API_BASE}/feed?${scopeParam}limit=${PAGE_SIZE}`,
          { headers: authHeaders() },
        );
        if (!res.ok) {
          if (!cancelled)
            setError("Couldn't load the feed. Try refreshing.");
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setFeed(data.items || []);
          setNextCursor(data.nextCursor ?? null);
        }
      } catch {
        if (!cancelled) setError("Couldn't load the feed. Try refreshing.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [scope]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const scopeParam = scope === "following" ? "scope=following&" : "";
      const res = await fetch(
        `${API_BASE}/feed?${scopeParam}limit=${PAGE_SIZE}&cursor=${encodeURIComponent(nextCursor)}`,
        { headers: authHeaders() },
      );
      if (!res.ok) {
        setMoreError("Couldn't load more.");
        return;
      }
      const data = await res.json();
      // Append, dropping any item already rendered so a cursor that
      // straddles equal timestamps can't duplicate a row.
      setFeed((prev) => {
        const seen = new Set(prev.map(feedKey));
        const fresh = (data.items || []).filter(
          (i: FeedItem) => !seen.has(feedKey(i)),
        );
        return [...prev, ...fresh];
      });
      setNextCursor(data.nextCursor ?? null);
    } catch {
      setMoreError("Couldn't load more.");
    } finally {
      setLoadingMore(false);
    }
  }

  // The newest review leads the feed in the wide featured treatment; the
  // rest follow two-up. Attendance rows (Following tab) stay quiet,
  // full-width lines between review rows.
  const featuredIndex = feed.findIndex((i) => i.type === "review");
  const featured = featuredIndex >= 0 ? feed[featuredIndex] : null;
  const rest = feed.filter((_, i) => i !== featuredIndex);

  return (
    <main className="page">
      {/* Mobile only: the masthead drops its search column on phones, and
          search is the feed's primary discovery behaviour. */}
      <div className="container show-mobile" style={{ paddingTop: "12px" }}>
        <ShowSearch />
      </div>

      <WriteReviewHero />

      <section className="band">
        <div
          className="container"
          style={{
            paddingTop: "clamp(32px, 5vw, 72px)",
            paddingBottom: "clamp(40px, 6vw, 96px)",
          }}
        >
          {/* Section heading + scope tabs. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "16px",
              marginBottom: "28px",
            }}
          >
            <h2 className="h2">Latest Reviews</h2>
            <SegmentedTabs
              label="Feed scope"
              value={scope}
              onChange={selectScope}
              options={[
                { value: "all", label: "All" },
                { value: "following", label: "Following" },
              ]}
            />
          </div>

          {loading && (
            <div className="stack" style={{ gap: "24px" }} aria-busy="true">
              <span className="sr-only">Loading…</span>
              <div className="card card-lg" style={{ height: "280px" }}>
                <div className="skeleton" style={{ width: "40%", height: "44px" }} />
                <div className="skeleton" style={{ width: "22%", height: "18px", marginTop: "18px" }} />
                <div className="skeleton" style={{ width: "70%", height: "22px", marginTop: "40px" }} />
              </div>
              <div className="grid-2">
                {[0, 1].map((n) => (
                  <div key={n} className="card" style={{ height: "220px" }}>
                    <div className="skeleton" style={{ width: "55%", height: "30px" }} />
                    <div className="skeleton" style={{ width: "30%", height: "16px", marginTop: "14px" }} />
                    <div className="skeleton" style={{ width: "85%", height: "18px", marginTop: "24px" }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loading && error && (
            <div className="notice notice-error">{error}</div>
          )}

          {!loading && !error && feed.length === 0 && (
            <div
              className="card"
              style={{
                textAlign: "center",
                padding: "56px 24px",
                fontSize: "17px",
                lineHeight: 1.5,
                color: "var(--ink-2)",
              }}
            >
              {scope === "following" ? (
                authUser ? (
                  <>
                    You&rsquo;re not following anyone yet. Open a user&rsquo;s
                    profile to follow them, or{" "}
                    <Link href="/people" className="link">
                      find people
                    </Link>
                    .
                  </>
                ) : (
                  <>
                    <Link
                      href="/signin?next=/?scope=following"
                      className="link"
                    >
                      Sign in
                    </Link>{" "}
                    to see reviews from people you follow.
                  </>
                )
              ) : authUser ? (
                "No reviews yet. Be the first to write one."
              ) : (
                "No reviews yet. Sign up to write the first one."
              )}
            </div>
          )}

          {!loading && !error && feed.length > 0 && (
            <div className="stack" style={{ gap: "24px" }}>
              {featured && featured.type === "review" && (
                <ReviewCard
                  item={featured}
                  viewerHandle={authUser?.handle ?? null}
                  featured
                />
              )}
              {rest.length > 0 && (
                <div className="grid-2">
                  {rest.map((item) =>
                    item.type === "review" ? (
                      <ReviewCard
                        key={`r:${item.reviewId}`}
                        item={item}
                        viewerHandle={authUser?.handle ?? null}
                      />
                    ) : (
                      // Attendance — deliberately quiet: a single muted
                      // line spanning the grid, clearly secondary to
                      // reviews, links to user + show.
                      <div
                        key={`a:${item.attendanceId}`}
                        className="meta"
                        style={{
                          gridColumn: "1 / -1",
                          display: "flex",
                          alignItems: "center",
                          flexWrap: "wrap",
                          gap: "6px",
                          padding: "4px 4px",
                          lineHeight: 1.5,
                        }}
                      >
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                        <Link
                          href={`/user/${item.userHandle}`}
                          className="link-quiet"
                          style={{ color: "var(--ink)", fontWeight: 600 }}
                        >
                          @{item.userHandle}
                        </Link>
                        <span>attended</span>
                        <Link
                          href={`/show/${item.show.id}`}
                          className="link-quiet"
                          style={{ color: "var(--ink)", fontWeight: 600 }}
                        >
                          {item.show.artist}
                        </Link>
                        <span>
                          · {item.show.venue} ·{" "}
                          {formatShowDate(item.show.localDate)}
                        </span>
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>
          )}

          {!loading && !error && nextCursor && (
            <div style={{ marginTop: "48px" }}>
              <LoadMore
                onClick={loadMore}
                loading={loadingMore}
                error={moreError}
              />
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
