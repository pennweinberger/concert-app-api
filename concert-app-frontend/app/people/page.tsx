"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import FollowButton from "../components/FollowButton";
import Avatar from "../components/Avatar";
import { authHeaders } from "../lib/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

const DEBOUNCE_MS = 250;
const MIN_QUERY_CHARS = 2;

type UserSearchResult = {
  handle: string;
  name: string | null;
  followerCount: number;
  reviewCount: number;
  attendedShowCount: number;
  isFollowing: boolean;
};

export default function PeoplePage() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const trimmed = q.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (trimmed.length < MIN_QUERY_CHARS) {
      setResults([]);
      setLoading(false);
      setSearched(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_BASE}/users/search?q=${encodeURIComponent(trimmed)}`,
          { headers: authHeaders() },
        );
        const data = await res.json();
        setResults(data.items ?? []);
        setSearched(true);
      } catch {
        setResults([]);
        setSearched(true);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q]);

  return (
    <main className="page">
      <div
        className="container-sm"
        style={{ paddingTop: "20px", paddingBottom: "clamp(28px, 4vw, 40px)" }}
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

        <h1 className="h1" style={{ marginTop: "16px" }}>
          Find Users
        </h1>

        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by handle or name"
          aria-label="Search by handle or name"
          style={{ marginTop: "24px" }}
        />
      </div>

      <section className="band">
        <div
          className="container-sm"
          style={{
            paddingTop: "clamp(28px, 4vw, 48px)",
            paddingBottom: "clamp(40px, 6vw, 80px)",
          }}
        >
          {q.trim().length < MIN_QUERY_CHARS && (
            <div className="meta" style={{ textAlign: "center", padding: "16px" }}>
              Search by handle or name
            </div>
          )}
          {loading && q.trim().length >= MIN_QUERY_CHARS && (
            <div className="meta" style={{ textAlign: "center", padding: "16px" }}>
              Searching…
            </div>
          )}
          {!loading && searched && results.length === 0 && (
            <div
              className="card"
              style={{
                textAlign: "center",
                padding: "48px 24px",
                fontSize: "17px",
                color: "var(--ink-2)",
              }}
            >
              No people found
            </div>
          )}

          {results.length > 0 && (
            <div className="stack" style={{ gap: "10px" }}>
              {results.map((u) => (
                <div
                  key={u.handle}
                  className="card"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "14px",
                    padding: "16px 18px",
                  }}
                >
                  <Link
                    href={`/user/${u.handle}`}
                    className="link-quiet"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "14px",
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <Avatar handle={u.handle} name={u.name} size={44} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: "16px" }}>
                        @{u.handle}
                      </div>
                      {u.name && (
                        <div
                          style={{
                            color: "var(--ink-2)",
                            fontSize: "14px",
                            marginTop: "2px",
                          }}
                        >
                          {u.name}
                        </div>
                      )}
                      <div className="meta" style={{ fontSize: "13px", marginTop: "2px" }}>
                        {u.reviewCount} review{u.reviewCount === 1 ? "" : "s"}
                        {" · "}
                        {u.attendedShowCount} show
                        {u.attendedShowCount === 1 ? "" : "s"}
                      </div>
                    </div>
                  </Link>
                  <FollowButton
                    handle={u.handle}
                    initialFollowing={u.isFollowing}
                    initialFollowerCount={u.followerCount}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
