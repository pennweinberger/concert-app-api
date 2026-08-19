// Shared, serverless-safe counter store for rate limiting.
//
// WHY THIS EXISTS
// The previous limiter kept counters in a process-local Map. On Vercel
// each invocation can land on a different instance, each starting with an
// empty Map, so "5 logins per minute per IP" really meant "5 per minute
// per IP PER INSTANCE" — the effective limit was multiplied by however
// many instances happened to be warm, and reset on every cold start. It
// was a decent typo guard and close to worthless as an abuse control.
//
// Upstash is an HTTP Redis, so it works from a serverless function with no
// connection pooling and no TCP socket to keep alive.
//
// FAIL-OPEN, DELIBERATELY
// If Redis is unreachable we allow the request and log. Rate limiting is a
// SECONDARY control: failing closed would turn an Upstash incident into a
// total signup/login outage for real users, which is a worse and far more
// likely outcome than the abuse it would prevent. The residual risk is
// that an attacker who can detect an Upstash outage gets an unlimited
// window — accepted, and the reason the failure is logged loudly rather
// than silently swallowed.
//
// Without Upstash env vars configured this transparently falls back to the
// old in-memory behaviour, so the code is safe to deploy before the
// service is provisioned.

export type RateDecision = {
  /** Requests made in the current window, including this one. */
  count: number;
  /** Seconds until the window resets. */
  resetSeconds: number;
  /** True when the counter could not be reached and we let the request through. */
  degraded: boolean;
};

export type RateLimitStore = {
  hit(key: string, windowMs: number): Promise<RateDecision>;
  readonly kind: "upstash" | "memory";
};

// ---------------------------------------------------------------------------
// In-memory fallback — the previous behaviour, kept for local dev and for
// the window before Upstash is configured.
// ---------------------------------------------------------------------------

type Bucket = { count: number; resetAt: number };
const MAX_BUCKETS = 10_000;

export function createMemoryStore(
  now: () => number = Date.now,
): RateLimitStore {
  const buckets = new Map<string, Bucket>();
  return {
    kind: "memory",
    async hit(key, windowMs) {
      const t = now();
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt < t) {
        // Hard cap so a flood of unique IPs can't exhaust function memory.
        if (buckets.size >= MAX_BUCKETS) buckets.clear();
        buckets.set(key, { count: 1, resetAt: t + windowMs });
        return {
          count: 1,
          resetSeconds: Math.ceil(windowMs / 1000),
          degraded: false,
        };
      }
      bucket.count++;
      return {
        count: bucket.count,
        resetSeconds: Math.max(0, Math.ceil((bucket.resetAt - t) / 1000)),
        degraded: false,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Upstash
// ---------------------------------------------------------------------------

export type UpstashConfig = {
  url: string;
  token: string;
  /** Guards against a slow Redis becoming a slow API. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onError?: (err: unknown) => void;
};

const DEFAULT_TIMEOUT_MS = 1200;

export function createUpstashStore(cfg: UpstashConfig): RateLimitStore {
  const doFetch = cfg.fetchImpl ?? fetch;
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = cfg.url.replace(/\/+$/, "");

  return {
    kind: "upstash",
    async hit(key, windowMs) {
      const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        // One round trip for the whole operation.
        //   INCR                  -> count in this window
        //   EXPIRE key sec NX     -> set the TTL only on the FIRST hit, so
        //                            the window is fixed rather than
        //                            sliding forward on every request
        //   TTL                   -> seconds left, for Retry-After
        const res = await doFetch(`${base}/pipeline`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfg.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify([
            ["INCR", key],
            ["EXPIRE", key, String(windowSec), "NX"],
            ["TTL", key],
          ]),
          signal: ctl.signal,
        });
        if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`);
        const body = (await res.json()) as { result?: unknown; error?: string }[];
        if (!Array.isArray(body) || body.length < 3) {
          throw new Error("Unexpected Upstash pipeline response");
        }
        const err = body.find((r) => r?.error);
        if (err) throw new Error(String(err.error));

        const count = Number(body[0]?.result ?? 0);
        const ttl = Number(body[2]?.result ?? windowSec);
        if (!Number.isFinite(count) || count <= 0) {
          throw new Error("Upstash returned a non-numeric count");
        }
        return {
          count,
          // TTL is -1 (no expiry) or -2 (missing) in edge cases; fall back
          // to the full window rather than reporting a nonsense Retry-After.
          resetSeconds: ttl > 0 ? ttl : windowSec,
          degraded: false,
        };
      } catch (e) {
        cfg.onError?.(e);
        // FAIL OPEN. count=1 reads as "first request in the window", so
        // the caller allows it.
        return { count: 1, resetSeconds: windowSec, degraded: true };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Picks Upstash when configured, otherwise the in-memory fallback.
 * Reading env here (not at module scope) keeps it testable.
 */
export function resolveRateLimitStore(
  env: NodeJS.ProcessEnv = process.env,
  onError?: (err: unknown) => void,
): RateLimitStore {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    return createUpstashStore({
      url,
      token,
      ...(onError ? { onError } : {}),
    });
  }
  return createMemoryStore();
}
