"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { clearSession } from "../lib/auth";

// Masthead account menu (all breakpoints). Collapses the secondary nav
// destinations behind an avatar trigger so the masthead stays one clean
// row. Accessible: opens on click/Enter/Space,
// closes on outside click, Escape (restoring focus to the trigger), or
// selecting an item. Preserves every destination + the sign-out action.
export default function ProfileMenu({
  handle,
  isAdmin,
}: {
  handle: string;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Move focus into the menu when it opens (keyboard users land on the
  // first item).
  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLElement>(
      '[role="menuitem"]',
    );
    first?.focus();
  }, [open]);

  const initial = handle.charAt(0).toUpperCase();

  return (
    <div ref={containerRef} style={{ position: "relative", marginLeft: "4px" }}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for @${handle}`}
        style={{
          height: 40,
          padding: "0 10px 0 4px",
          borderRadius: 999,
          border: "1px solid var(--line)",
          background: "var(--bg)",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "inherit",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: "var(--ink)",
            color: "#fff",
            fontSize: 12.5,
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {initial}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--muted)"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 130ms ease",
          }}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account"
          className="menu"
          style={{ top: "calc(100% + 10px)", right: 0, width: 240 }}
        >
          <div
            style={{
              padding: "10px 12px 12px",
              marginBottom: 6,
              borderBottom: "1px solid var(--line-soft)",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>@{handle}</span>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Signed in
            </span>
          </div>
          <Link
            role="menuitem"
            href={`/user/${handle}`}
            className="menu-item"
            onClick={() => setOpen(false)}
          >
            Profile
          </Link>
          {/* Mobile only: desktop shows these in the masthead row. */}
          <Link
            role="menuitem"
            href="/review/new"
            className="menu-item show-mobile"
            onClick={() => setOpen(false)}
          >
            Write Review
          </Link>
          <Link
            role="menuitem"
            href="/people"
            className="menu-item show-mobile"
            onClick={() => setOpen(false)}
          >
            Find Users
          </Link>
          <Link
            role="menuitem"
            href="/settings"
            className="menu-item"
            onClick={() => setOpen(false)}
          >
            Settings
          </Link>
          {isAdmin && (
            <Link
              role="menuitem"
              href="/admin/moderation"
              className="menu-item menu-item-danger"
              onClick={() => setOpen(false)}
            >
              Admin
            </Link>
          )}
          <div aria-hidden="true" className="menu-divider" />
          <button
            role="menuitem"
            className="menu-item menu-item-muted"
            onClick={() => {
              setOpen(false);
              clearSession();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
