"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authHeaders, useAuthUser } from "./lib/auth";
import ShowSearch from "./components/ShowSearch";
import Masthead from "./components/Masthead";
import ReviewCard from "./components/ReviewCard";
import LoadMore from "./components/LoadMore";
import PageGlow from "./components/PageGlow";
import WriteReviewRow from "./components/WriteReviewRow";
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

  return (
    <main
      style={{
        background: "#0a0a0a",
        minHeight: "100vh",
        color: "#f4f1ea",
        padding: "24px",
      }}
    >
      <PageGlow />

      <div
        style={{
          maxWidth: "700px",
          margin: "0 auto",
          // Above PageGlow, which is a fixed layer at z-index 0.
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* The magenta WriteReviewRow below is this page's Write Review
            entry point, so the masthead pill is suppressed here. */}
        <Masthead hideWriteReview />

        {/* Full-width search — primary discovery behavior, always visible. */}
        <ShowSearch fullWidth />

        <WriteReviewRow />

        {/* Section heading + scope tabs. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            marginTop: "24px",
            marginBottom: "4px",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: "20px",
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            Latest Reviews
          </h1>
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
          <div style={{ color: "#888", fontSize: "14px", padding: "20px 0" }}>
            Loading…
          </div>
        )}

        {!loading && error && (
          <div
            style={{ color: "#ff8080", fontSize: "14px", padding: "20px 0" }}
          >
            {error}
          </div>
        )}

        {!loading && !error && feed.length === 0 && (
          <div
            style={{
              color: "#888",
              fontSize: "15px",
              padding: "24px 0",
              lineHeight: 1.6,
            }}
          >
            {scope === "following" ? (
              authUser ? (
                <>
                  You&rsquo;re not following anyone yet. Open a user&rsquo;s
                  profile to follow them.
                </>
              ) : (
                <>
                  <Link
                    href="/signin?next=/?scope=following"
                    style={{
                      color: "#f4f1ea",
                      textDecoration: "underline",
                      textUnderlineOffset: "3px",
                    }}
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
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              // Cards carry their own border and fill, so they need far
              // less separation than the borderless items did at 46px.
              gap: "15px",
              marginTop: "14px",
            }}
          >
            {feed.map((item, i) =>
              item.type === "review" ? (
                <ReviewCard
                  key={`r:${item.reviewId}`}
                  item={item}
                  viewerHandle={authUser?.handle ?? null}
                  tintIndex={i}
                />
              ) : (
                // Attendance — deliberately quiet: a single muted line,
                // clearly secondary to reviews, links to user + show.
                <div
                  key={`a:${item.attendanceId}`}
                  style={{
                    fontSize: "13px",
                    color: "#6a6a6a",
                    lineHeight: 1.5,
                  }}
                >
                  <Link
                    href={`/user/${item.userHandle}`}
                    style={{ color: "#8a8a8a", textDecoration: "none" }}
                  >
                    @{item.userHandle}
                  </Link>
                  <span> attended </span>
                  <Link
                    href={`/show/${item.show.id}`}
                    style={{ color: "#8a8a8a", textDecoration: "none" }}
                  >
                    {item.show.artist}
                  </Link>
                  <span style={{ color: "#5a5a5a" }}>
                    {" · "}
                    {item.show.venue}
                    {" · "}
                    {formatShowDate(item.show.localDate)}
                  </span>
                </div>
              ),
            )}
          </div>
        )}

        {!loading && !error && nextCursor && (
          <div style={{ marginTop: "46px" }}>
            <LoadMore
              onClick={loadMore}
              loading={loadingMore}
              error={moreError}
            />
          </div>
        )}
      </div>
    </main>
  );
}
