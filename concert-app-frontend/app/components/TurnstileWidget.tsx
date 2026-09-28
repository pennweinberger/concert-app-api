"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";

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
//
// When the server has a secret configured, a missing or invalid token is
// always rejected — the server only fails open when Cloudflare ITSELF is
// unreachable from the server (see src/lib/turnstile.ts). So a widget that
// fails to load in the browser is a dead end, and must be presented as one
// the user can recover from (retry / refresh), never as "you can continue".

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id: string) => void;
      remove: (id: string) => void;
    };
  }
}

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** The public site key, or undefined when Turnstile isn't configured. */
export function getTurnstileSiteKey(): string | undefined {
  // Literal access so Next inlines the value at build time.
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined;
}

/**
 * Whether signup must wait for a Turnstile token. Always true in a built
 * deployment: without a site key the widget can't render, and the API
 * (which holds the secret) is certain to reject a token-less request — so a
 * build missing its key fails closed rather than enabling a dead-end form.
 * `next dev` is the one exception, so local development works without
 * Cloudflare.
 */
export function isTurnstileRequired(): boolean {
  return !!getTurnstileSiteKey() || process.env.NODE_ENV === "production";
}

export type TurnstileHandle = {
  /**
   * Discard the current token and issue a fresh challenge. Turnstile tokens
   * are single-use and the server spends one on every submission, so this
   * must run after any failed signup before the user can retry.
   */
  reset: () => void;
};

export default function TurnstileWidget({
  onToken,
  ref,
}: {
  /** Called with the token, or null when there is no usable token. */
  onToken: (token: string | null) => void;
  ref?: Ref<TurnstileHandle>;
}) {
  const siteKey = getTurnstileSiteKey();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [expired, setExpired] = useState(false);
  // Bumped to tear the widget down and build it again from scratch (the
  // retry path after a load failure).
  const [attempt, setAttempt] = useState(0);

  // Callers may pass an inline function; keep the effect below from
  // re-rendering the widget every time they do.
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  const markFailed = useCallback(() => {
    setFailed(true);
    onTokenRef.current(null);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      reset() {
        onTokenRef.current(null);
        setExpired(false);
        const id = widgetIdRef.current;
        if (id && window.turnstile) {
          try {
            window.turnstile.reset(id);
            return;
          } catch {
            // Fall through to a full rebuild.
          }
        }
        setFailed(false);
        setAttempt((n) => n + 1);
      },
    }),
    [],
  );

  useEffect(() => {
    if (!siteKey || !boxRef.current) return;
    let cancelled = false;

    function render() {
      if (cancelled || !window.turnstile || !boxRef.current) return;
      if (widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(boxRef.current, {
        sitekey: siteKey,
        theme: "light",
        callback: (token: string) => {
          setFailed(false);
          setExpired(false);
          onTokenRef.current(token);
        },
        // A stale token is worse than no token — the server would reject
        // it and the user would see a confusing failure.
        "expired-callback": () => {
          setExpired(true);
          onTokenRef.current(null);
        },
        "error-callback": () => markFailed(),
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
        existing.addEventListener("error", markFailed);
      } else {
        const script = document.createElement("script");
        script.src = SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.onload = render;
        script.onerror = () => {
          // Let a retry request the script again rather than waiting on
          // this failed element forever.
          script.remove();
          markFailed();
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
  }, [siteKey, attempt, markFailed]);

  if (!siteKey) {
    if (!isTurnstileRequired()) return null;
    return (
      <div
        className="notice notice-error"
        role="alert"
        style={{ marginBottom: "14px", fontSize: "14px" }}
      >
        Sign-up is unavailable right now because the verification check
        isn&rsquo;t configured. Please try again later.
      </div>
    );
  }

  return (
    <div style={{ marginBottom: "14px" }}>
      <div ref={boxRef} />
      {failed && (
        <div
          className="notice notice-error"
          role="alert"
          style={{ marginTop: "8px", fontSize: "14px" }}
        >
          We couldn&rsquo;t load the verification check, so sign-up can&rsquo;t
          continue yet. Check your connection or any content blocker, then{" "}
          <button
            type="button"
            className="link"
            onClick={() => {
              setFailed(false);
              setAttempt((n) => n + 1);
            }}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              font: "inherit",
              cursor: "pointer",
            }}
          >
            try again
          </button>{" "}
          or refresh the page.
        </div>
      )}
      {expired && !failed && (
        <div className="hint" style={{ marginTop: "6px" }}>
          Verification expired. Please complete it again.
        </div>
      )}
    </div>
  );
}
