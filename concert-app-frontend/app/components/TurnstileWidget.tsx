"use client";

import { useEffect, useRef, useState } from "react";

// Cloudflare Turnstile — signup only.
//
// Renders nothing at all when NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset, so
// the app works normally before Cloudflare is provisioned and in local
// development. The site key is public by design (it identifies the widget,
// it does not authorise anything); the SECRET key lives only on the
// server and must never appear in this bundle.
//
// The script is loaded on demand rather than in the root layout so it is
// only fetched by people who actually open the signup page.

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export default function TurnstileWidget({
  onToken,
}: {
  /** Called with the token, or null when it expires and must be redone. */
  onToken: (token: string | null) => void;
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!siteKey || !boxRef.current) return;
    let cancelled = false;

    function render() {
      if (cancelled || !window.turnstile || !boxRef.current) return;
      if (widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(boxRef.current, {
        sitekey: siteKey,
        theme: "dark",
        callback: (token: string) => onToken(token),
        // A stale token is worse than no token — the server would reject
        // it and the user would see a confusing failure.
        "expired-callback": () => onToken(null),
        "error-callback": () => {
          // Cloudflare unreachable. The server fails open in this case, so
          // let the user proceed rather than trapping them behind a widget
          // that will never load.
          setFailed(true);
          onToken(null);
        },
      });
    }

    if (window.turnstile) {
      render();
    } else {
      const existing = document.querySelector<HTMLScriptElement>(
        `script[src="${SCRIPT_SRC}"]`,
      );
      if (existing) {
        existing.addEventListener("load", render);
      } else {
        const script = document.createElement("script");
        script.src = SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.onload = render;
        script.onerror = () => {
          setFailed(true);
          onToken(null);
        };
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      const id = widgetIdRef.current;
      if (id && window.turnstile) {
        try {
          window.turnstile.remove(id);
        } catch {
          // Widget already gone — nothing to clean up.
        }
      }
      widgetIdRef.current = null;
    };
  }, [siteKey, onToken]);

  if (!siteKey) return null;

  return (
    <div style={{ marginBottom: "14px" }}>
      <div ref={boxRef} />
      {failed && (
        <div style={{ fontSize: "12.5px", color: "#8a6a6a", marginTop: "6px" }}>
          Couldn&rsquo;t load the verification check. You can still continue.
        </div>
      )}
    </div>
  );
}
