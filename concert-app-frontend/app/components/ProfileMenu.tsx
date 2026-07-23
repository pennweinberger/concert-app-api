"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { clearSession } from "../lib/auth";

// Compact-masthead account menu (mobile / narrow tablet). Collapses the
// secondary nav destinations behind a monochrome avatar trigger so the
// masthead stays one clean row. Accessible: opens on click/Enter/Space,
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
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        style={{
          width: 30,
          height: 30,
          borderRadius: "50%",
          background: "#2a2a2a",
          border: "none",
          color: "#f4f1ea",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          fontFamily: "inherit",
        }}
      >
        {initial}
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            minWidth: 172,
            background: "#141414",
            border: "1px solid #262626",
            borderRadius: 10,
            overflow: "hidden",
            zIndex: 60,
            padding: "4px 0",
          }}
        >
          <Link
            role="menuitem"
            href={`/user/${handle}`}
            className="profile-menu-item"
            onClick={() => setOpen(false)}
          >
            Profile
          </Link>
          <Link
            role="menuitem"
            href="/people"
            className="profile-menu-item"
            onClick={() => setOpen(false)}
          >
            Find Users
          </Link>
          <Link
            role="menuitem"
            href="/settings"
            className="profile-menu-item"
            onClick={() => setOpen(false)}
          >
            Settings
          </Link>
          {isAdmin && (
            <Link
              role="menuitem"
              href="/admin/moderation"
              className="profile-menu-item"
              style={{ color: "#ff8080" }}
              onClick={() => setOpen(false)}
            >
              Admin
            </Link>
          )}
          <div
            aria-hidden="true"
            style={{ height: 1, background: "#262626", margin: "4px 0" }}
          />
          <button
            role="menuitem"
            className="profile-menu-item"
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
