// Tiny client-side auth helper. JWT lives in localStorage, alongside a
// cached copy of the basic user info so the UI can render greetings
// without hitting the network on every page load.
//
// The JWT is the source of truth for the backend (server validates it on
// every protected request). The cached user is purely a UX convenience.

import { useSyncExternalStore } from "react";

export type AuthUser = {
  id: string;
  handle: string;
};

const TOKEN_KEY = "afterset_token";
const USER_KEY = "afterset_user";
const AUTH_EVENT = "afterset:auth";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: AuthUser): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event(AUTH_EVENT));
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
  window.dispatchEvent(new Event(AUTH_EVENT));
}

// ---- useAuthUser via useSyncExternalStore -------------------------------
//
// useSyncExternalStore needs getSnapshot to return a stable reference when
// the underlying value hasn't changed (else infinite re-render). Since
// getUser() does a fresh JSON.parse each call, we memoize against the raw
// localStorage string.

let cachedRaw: string | null | undefined = undefined;
let cachedUser: AuthUser | null = null;

function getUserSnapshot(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (raw === cachedRaw) return cachedUser;
  cachedRaw = raw;
  try {
    cachedUser = raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    cachedUser = null;
  }
  return cachedUser;
}

function getUserServerSnapshot(): null {
  return null;
}

function subscribeAuth(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(AUTH_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(AUTH_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/**
 * React hook returning the current AuthUser (or null if signed out).
 * Re-renders when the session changes via setSession/clearSession, and
 * when localStorage changes in other tabs.
 *
 * Note: returns null during SSR and the first client render (to match
 * the server output). After hydration commits, returns the real value.
 */
export function useAuthUser(): AuthUser | null {
  return useSyncExternalStore(
    subscribeAuth,
    getUserSnapshot,
    getUserServerSnapshot,
  );
}
