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
  avatarUrl: string | null;
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
    <main
      style={{
        background: "#0a0a0a",
        minHeight: "100vh",
        color: "#f4f1ea",
        padding: "24px",
      }}
    >
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
          Find Users
        </h1>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by handle or name"
          style={{
            width: "100%",
            padding: "14px",
            borderRadius: "12px",
            border: "1px solid #333",
            background: "#1a1a1a",
            color: "#f4f1ea",
            marginBottom: "20px",
            boxSizing: "border-box",
          }}
        />

        {q.trim().length < MIN_QUERY_CHARS && (
          <div style={{ color: "#888", padding: "16px" }}>
            Search by handle or name
          </div>
        )}
        {loading && q.trim().length >= MIN_QUERY_CHARS && (
          <div style={{ color: "#888", padding: "16px" }}>Searching…</div>
        )}
        {!loading && searched && results.length === 0 && (
          <div style={{ color: "#888", padding: "16px" }}>No people found</div>
        )}

        {results.map((u) => (
          <div
            key={u.handle}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px",
              borderRadius: "12px",
              background: "#1a1a1a",
              marginBottom: "8px",
              border: "1px solid #222",
            }}
          >
            <Link
              href={`/user/${u.handle}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                flex: 1,
                textDecoration: "none",
                color: "inherit",
                minWidth: 0,
              }}
            >
              <Avatar
                handle={u.handle}
                name={u.name}
                avatarUrl={u.avatarUrl}
                size={40}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>@{u.handle}</div>
                {u.name && (
                  <div
                    style={{
                      color: "#aaa",
                      fontSize: "14px",
                      marginTop: "2px",
                    }}
                  >
                    {u.name}
                  </div>
                )}
                <div
                  style={{
                    color: "#888",
                    fontSize: "13px",
                    marginTop: "2px",
                  }}
                >
                  {u.reviewCount} review{u.reviewCount === 1 ? "" : "s"}
                  {" • "}
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
    </main>
  );
}
