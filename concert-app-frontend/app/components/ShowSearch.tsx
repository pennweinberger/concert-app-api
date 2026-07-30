"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getToken, authHeaders } from "../lib/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

// Unified show search: hits our DB AND Ticketmaster in parallel, merges
// + dedupes + ranks client-side, presents as one mixed list. The user
// should not be aware which row came from which source — that detail
// only matters at click time (DB rows navigate; Ticketmaster rows
// promote via /shows/confirm and then navigate).

type DbItem = {
  source: "db";
  id: string;
  artistName: string;
  venueName: string;
  city: string;
  localDate: string;
  reviewCount: number;
  attendanceCount: number;
};

type TmItem = {
  source: "ticketmaster";
  externalId: string;
  artistName: string;
  // Stable Ticketmaster ids carried forward to /shows/confirm so it
  // can resolve to a canonical Artist/Venue regardless of which
  // spelling variant TM returned for this event.
  artistTicketmasterId: string | null;
  venueName: string;
  venueTicketmasterId: string | null;
  city: string;
  localDate: string;
};

type MergedItem = DbItem | TmItem;

const DAY_MS = 86_400_000;
const MIN_QUERY_CHARS = 2;
const DEBOUNCE_MS = 250;
const MAX_DISPLAY = 12;

function dateOnly(s: string): string {
  return (s ?? "").slice(0, 10);
}

function normalize(s: string | undefined | null): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function dedupeKey(item: MergedItem): string {
  return [
    normalize(item.artistName),
    normalize(item.venueName),
    dateOnly(item.localDate),
  ].join("|");
}

// Recency tier (user-spec ranking):
//   1: past 30 days
//   2: next 7 days
//   3: other past (>30 days ago)
//   4: future beyond 7 days
function rankTier(localDate: Date, now: Date): number {
  const days = (localDate.getTime() - now.getTime()) / DAY_MS;
  if (days <= 0 && days >= -30) return 1;
  if (days > 0 && days <= 7) return 2;
  if (days < -30) return 3;
  return 4;
}

// Within-tier secondary key. For tiers 1+3 (past), more recent wins,
// so we return -ms (smaller value sorts first → bigger ms = closer to
// now). For tiers 2+4 (future), soonest wins, so we return +ms.
function rankWithin(tier: number, localDate: Date): number {
  const ms = localDate.getTime();
  return tier === 1 || tier === 3 ? -ms : ms;
}

function rankAndSort(items: MergedItem[]): MergedItem[] {
  const now = new Date();
  return items
    .map((item) => {
      const ld = new Date(item.localDate);
      const tier = rankTier(ld, now);
      return { item, tier, within: rankWithin(tier, ld) };
    })
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return a.within - b.within;
    })
    .map((x) => x.item);
}

export default function ShowSearch({
  fullWidth = false,
}: {
  fullWidth?: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MergedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [promotingKey, setPromotingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Debounced parallel fetch + merge + dedupe + rank.
  useEffect(() => {
    const trimmed = q.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (trimmed.length < MIN_QUERY_CHARS) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const [dbRes, tmRes] = await Promise.all([
          fetch(
            `${API_BASE}/shows?q=${encodeURIComponent(trimmed)}&limit=20`,
          ),
          fetch(
            `${API_BASE}/shows/search?q=${encodeURIComponent(trimmed)}`,
          ),
        ]);
        const dbData = dbRes.ok ? await dbRes.json() : { items: [] };
        const tmData = tmRes.ok ? await tmRes.json() : { items: [] };

        const dbItems: DbItem[] = (dbData.items ?? []).map((i: any) => ({
          source: "db",
          id: i.id,
          artistName: i.artist?.name ?? "",
          venueName: i.venue?.name ?? "",
          city: i.venue?.city ?? "",
          localDate: i.localDate ?? "",
          reviewCount: i.reviewCount ?? 0,
          attendanceCount: i.attendanceCount ?? 0,
        }));
        const tmItems: TmItem[] = (tmData.items ?? [])
          .filter(
            (i: any) =>
              typeof i.artist === "string" &&
              typeof i.venue === "string" &&
              typeof i.localDate === "string",
          )
          .map((i: any) => ({
            source: "ticketmaster" as const,
            externalId: i.providerEventId,
            artistName: i.artist,
            artistTicketmasterId: i.artistTicketmasterId ?? null,
            venueName: i.venue,
            venueTicketmasterId: i.venueTicketmasterId ?? null,
            city: i.city ?? "",
            localDate: i.localDate,
          }));

        const dbKeys = new Set(dbItems.map(dedupeKey));
        const filteredTm = tmItems.filter((t) => !dbKeys.has(dedupeKey(t)));
        const merged = rankAndSort([...dbItems, ...filteredTm]).slice(
          0,
          MAX_DISPLAY,
        );
        setResults(merged);
        setError(null);
      } catch {
        setError("Could not search.");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
  }, [q]);

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function onItemClick(item: MergedItem) {
    if (item.source === "db") {
      router.push(`/show/${item.id}`);
      setOpen(false);
      return;
    }
    // Ticketmaster row — gate on auth, then promote via /shows/confirm.
    const token = getToken();
    if (!token) {
      router.push(`/signin?next=${encodeURIComponent("/")}`);
      return;
    }
    setPromotingKey(item.externalId);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/shows/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          artist: item.artistName,
          venue: item.venueName,
          city: item.city,
          localDate: dateOnly(item.localDate),
          artistTicketmasterId: item.artistTicketmasterId,
          venueTicketmasterId: item.venueTicketmasterId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.showId) {
        setError("Could not open this show.");
        return;
      }
      router.push(`/show/${data.showId}`);
      setOpen(false);
    } catch {
      setError("Network error.");
    } finally {
      setPromotingKey(null);
    }
  }

  const showDropdown = open && q.trim().length >= MIN_QUERY_CHARS;

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        maxWidth: fullWidth ? "100%" : 560,
        margin: fullWidth ? "0" : "0 auto 24px",
      }}
    >
      {fullWidth && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 15,
            top: "50%",
            transform: "translateY(-50%)",
            color: "#6f6f6f",
            pointerEvents: "none",
            display: "inline-flex",
          }}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
        </span>
      )}
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={
          fullWidth
            ? "Search artists, shows, venues"
            : "Find a show — artist, venue, or city"
        }
        autoComplete="off"
        spellCheck={false}
        style={{
          width: "100%",
          padding: fullWidth ? "13px 18px 13px 44px" : "12px 14px",
          // Pill on the feed (editorial treatment); the compact variant
          // used elsewhere keeps its original rounded-rect.
          borderRadius: fullWidth ? "26px" : "12px",
          border: "1px solid #2a2a2a",
          background: "#141414",
          color: "#f4f1ea",
          fontSize: "15px",
          boxSizing: "border-box",
        }}
      />

      {showDropdown && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "#0e0e0e",
            border: "1px solid #2a2a2a",
            borderRadius: "12px",
            maxHeight: "480px",
            overflowY: "auto",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
            zIndex: 50,
          }}
        >
          {loading && results.length === 0 && (
            <div
              style={{ padding: "16px", color: "#777", fontSize: "14px" }}
            >
              Searching…
            </div>
          )}

          {!loading && results.length === 0 && (
            <div
              style={{ padding: "16px", color: "#aaa", fontSize: "14px" }}
            >
              No shows matching &ldquo;{q.trim()}&rdquo; yet.
              <div
                style={{
                  marginTop: 6,
                  color: "#777",
                  fontSize: "13px",
                }}
              >
                If you attended this show,{" "}
                <a
                  href="/review/new"
                  style={{
                    color: "#f4f1ea",
                    textDecoration: "underline",
                  }}
                >
                  write a review
                </a>{" "}
                to add it.
              </div>
            </div>
          )}

          {results.map((item) => {
            const isPromoting =
              item.source === "ticketmaster" &&
              promotingKey === item.externalId;
            const localDate = new Date(item.localDate);
            const dateLabel = isNaN(localDate.getTime())
              ? item.localDate
              : localDate.toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                });
            const key =
              item.source === "db"
                ? `db_${item.id}`
                : `tm_${item.externalId}`;
            return (
              <button
                key={key}
                onClick={() => onItemClick(item)}
                disabled={isPromoting}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid #161616",
                  padding: "12px 14px",
                  cursor: isPromoting ? "wait" : "pointer",
                  color: "#f4f1ea",
                  fontSize: "14px",
                }}
              >
                <div style={{ fontWeight: "bold", marginBottom: 2 }}>
                  {item.artistName}
                </div>
                <div style={{ color: "#aaa", fontSize: "13px" }}>
                  {item.venueName}
                  {item.city ? ` · ${item.city}` : ""}
                  {" · "}
                  {dateLabel}
                </div>
                {item.source === "db" &&
                  (item.reviewCount > 0 || item.attendanceCount > 0) && (
                    <div
                      style={{
                        color: "#777",
                        fontSize: "12px",
                        marginTop: 4,
                      }}
                    >
                      {item.reviewCount > 0 &&
                        `${item.reviewCount} ${item.reviewCount === 1 ? "review" : "reviews"}`}
                      {item.reviewCount > 0 && item.attendanceCount > 0 && " · "}
                      {item.attendanceCount > 0 && `${item.attendanceCount} attended`}
                    </div>
                  )}
                {isPromoting && (
                  <div
                    style={{
                      color: "#aaa",
                      fontSize: "12px",
                      marginTop: 4,
                    }}
                  >
                    Opening…
                  </div>
                )}
              </button>
            );
          })}

          {error && (
            <div
              style={{
                padding: "12px 14px",
                color: "#ff8080",
                fontSize: "13px",
              }}
            >
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
