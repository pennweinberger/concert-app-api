import { describe, it, expect, vi } from "vitest";
import { verifyTurnstile } from "./turnstile.js";

const ok = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("verifyTurnstile — the check working", () => {
  it("accepts a token Cloudflare confirms", async () => {
    const r = await verifyTurnstile("tok", "1.2.3.4", {
      secret: "s",
      fetchImpl: ok({ success: true }),
    });
    expect(r).toEqual({ ok: true, reason: "verified" });
  });

  it("REJECTS a missing token — this is the whole point of the control", async () => {
    for (const bad of [undefined, null, "", "   ", 42]) {
      const r = await verifyTurnstile(bad, undefined, { secret: "s" });
      expect(r.ok).toBe(false);
      expect(r).toMatchObject({ reason: "missing_token" });
    }
  });

  it("rejects a token Cloudflare says is invalid", async () => {
    const r = await verifyTurnstile("tok", undefined, {
      secret: "s",
      fetchImpl: ok({ success: false, "error-codes": ["invalid-input-response"] }),
    });
    expect(r).toMatchObject({ ok: false, reason: "invalid_token" });
  });

  it("sends the secret, token and caller IP", async () => {
    const f = ok({ success: true });
    await verifyTurnstile("tok", "9.9.9.9", { secret: "shh", fetchImpl: f });
    const body = String((f as any).mock.calls[0][1].body);
    expect(body).toContain("secret=shh");
    expect(body).toContain("response=tok");
    expect(body).toContain("remoteip=9.9.9.9");
  });
});

describe("verifyTurnstile — outage policy", () => {
  /**
   * Failing closed would turn a Cloudflare incident into a total signup
   * outage. That is a certain harm to real users; bots slipping through a
   * rare outage window is a recoverable one, and the shared rate limiter
   * still applies underneath.
   */
  it("FAILS OPEN when Cloudflare is unreachable, and reports it", async () => {
    const onError = vi.fn();
    const f = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const r = await verifyTurnstile("tok", undefined, { secret: "s", fetchImpl: f, onError });
    expect(r).toEqual({ ok: true, reason: "provider_unavailable" });
    expect(onError).toHaveBeenCalledOnce();
  });

  it("fails open on a 5xx from Cloudflare", async () => {
    const r = await verifyTurnstile("tok", undefined, {
      secret: "s",
      fetchImpl: ok({}, 503),
    });
    expect(r).toMatchObject({ ok: true, reason: "provider_unavailable" });
  });

  /**
   * A bad secret is OUR bug. Rejecting real signups because we shipped
   * misconfiguration would be self-inflicted damage, so it is treated as
   * an outage and logged rather than blamed on the user.
   */
  it("treats a misconfigured secret as an outage, not a failed challenge", async () => {
    const onError = vi.fn();
    for (const code of ["missing-input-secret", "invalid-input-secret", "bad-request"]) {
      const r = await verifyTurnstile("tok", undefined, {
        secret: "s",
        fetchImpl: ok({ success: false, "error-codes": [code] }),
        onError,
      });
      expect(r).toMatchObject({ ok: true, reason: "provider_unavailable" });
    }
    expect(onError).toHaveBeenCalledTimes(3);
  });

  it("is inert until a secret is configured, so it ships ahead of provisioning", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    const r = await verifyTurnstile(undefined, undefined, { secret: undefined, fetchImpl: f });
    expect(r).toEqual({ ok: true, reason: "not_configured" });
    expect(f).not.toHaveBeenCalled();
  });
});
