// Cloudflare Turnstile verification.
//
// Applied to SIGNUP ONLY. Login, reviews and comments are deliberately
// untouched: those are either already rate limited or require an
// authenticated account, and a challenge on every action is friction that
// buys very little.
//
// FAILURE POLICY — the two cases are not the same and must not be
// collapsed:
//
//   1. The token is missing, malformed, or Cloudflare says it is invalid.
//      -> REJECT. This is the check working, not an outage. Someone
//         posting to /auth/register without a token is exactly what the
//         control exists to stop.
//
//   2. Cloudflare is unreachable, times out, or returns 5xx.
//      -> ALLOW, and log. Failing closed would turn a Cloudflare incident
//         into a total signup outage. Signup being unavailable is a
//         certain, visible harm to real users; bots getting through during
//         a rare outage window is a possible, recoverable one — and the
//         shared rate limiter still applies underneath.
//
// The residual risk is that an attacker able to detect (or induce) a
// Turnstile outage gets a window with only rate limiting in front of them.
// Accepted deliberately; the outage is logged loudly so it is not silent.

const VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const DEFAULT_TIMEOUT_MS = 4000;

export type TurnstileOutcome =
  | { ok: true; reason: "verified" | "not_configured" | "provider_unavailable" }
  | { ok: false; reason: "missing_token" | "invalid_token"; codes?: string[] };

export type VerifyTurnstileDeps = {
  secret?: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  onError?: (err: unknown) => void;
};

export async function verifyTurnstile(
  token: unknown,
  remoteIp: string | undefined,
  deps: VerifyTurnstileDeps = {},
): Promise<TurnstileOutcome> {
  const secret = deps.secret ?? process.env.TURNSTILE_SECRET_KEY;

  // Not provisioned yet — behave exactly as before so this can ship ahead
  // of the Cloudflare setup without blocking anyone.
  if (!secret) return { ok: true, reason: "not_configured" };

  if (typeof token !== "string" || token.trim() === "") {
    return { ok: false, reason: "missing_token" };
  }

  const doFetch = deps.fetchImpl ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token.trim());
    if (remoteIp) form.set("remoteip", remoteIp);

    const res = await doFetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: ctl.signal,
    });
    // A non-2xx from Cloudflare is an OUTAGE, not a failed challenge.
    if (!res.ok) throw new Error(`Turnstile HTTP ${res.status}`);

    const body = (await res.json()) as {
      success?: boolean;
      "error-codes"?: string[];
    };
    if (body?.success === true) return { ok: true, reason: "verified" };

    const codes = body?.["error-codes"] ?? [];
    // These specific codes mean OUR configuration is broken, not that the
    // user failed a challenge. Rejecting real signups because we shipped a
    // bad secret would be self-inflicted; treat it as an outage and log.
    const ourFault = codes.some((c) =>
      ["missing-input-secret", "invalid-input-secret", "bad-request"].includes(c),
    );
    if (ourFault) {
      deps.onError?.(new Error(`Turnstile misconfigured: ${codes.join(",")}`));
      return { ok: true, reason: "provider_unavailable" };
    }
    return { ok: false, reason: "invalid_token", codes };
  } catch (e) {
    deps.onError?.(e);
    return { ok: true, reason: "provider_unavailable" };
  } finally {
    clearTimeout(timer);
  }
}
