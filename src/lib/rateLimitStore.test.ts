import { describe, it, expect, vi } from "vitest";
import {
  createMemoryStore,
  createUpstashStore,
  resolveRateLimitStore,
} from "./rateLimitStore.js";

function upstashOk(count: number, ttl: number) {
  return vi.fn(async () =>
    new Response(
      JSON.stringify([{ result: count }, { result: 1 }, { result: ttl }]),
      { status: 200 },
    ),
  ) as unknown as typeof fetch;
}

describe("memory store", () => {
  it("counts within a window and resets after it", async () => {
    let t = 1_000_000;
    const s = createMemoryStore(() => t);
    expect((await s.hit("k", 60_000)).count).toBe(1);
    expect((await s.hit("k", 60_000)).count).toBe(2);
    t += 61_000;
    expect((await s.hit("k", 60_000)).count).toBe(1);
  });

  it("keeps separate keys independent", async () => {
    const s = createMemoryStore();
    await s.hit("a", 60_000);
    await s.hit("a", 60_000);
    expect((await s.hit("b", 60_000)).count).toBe(1);
  });
});

describe("upstash store", () => {
  it("returns the shared count and TTL from one pipelined call", async () => {
    const f = upstashOk(7, 42);
    const s = createUpstashStore({ url: "https://x", token: "t", fetchImpl: f });
    const r = await s.hit("rl:login:1.2.3.4", 60_000);
    expect(r).toEqual({ count: 7, resetSeconds: 42, degraded: false });
    expect(f).toHaveBeenCalledOnce();
  });

  it("sets the TTL only on the first hit so the window is fixed, not sliding", async () => {
    const f = upstashOk(1, 60);
    const s = createUpstashStore({ url: "https://x", token: "t", fetchImpl: f });
    await s.hit("k", 60_000);
    const body = JSON.parse((f as any).mock.calls[0][1].body);
    expect(body).toEqual([
      ["INCR", "k"],
      ["EXPIRE", "k", "60", "NX"],
      ["TTL", "k"],
    ]);
  });

  it("strips a trailing slash from the configured url", async () => {
    const f = upstashOk(1, 60);
    const s = createUpstashStore({ url: "https://x/", token: "t", fetchImpl: f });
    await s.hit("k", 60_000);
    expect((f as any).mock.calls[0][0]).toBe("https://x/pipeline");
  });

  /**
   * Fail-open is a deliberate policy, not an accident: rate limiting is a
   * secondary control, and failing closed would turn an Upstash incident
   * into a total signup/login outage.
   */
  it("FAILS OPEN when Redis is unreachable, and reports it", async () => {
    const onError = vi.fn();
    const f = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const s = createUpstashStore({ url: "https://x", token: "t", fetchImpl: f, onError });
    const r = await s.hit("k", 60_000);
    expect(r.degraded).toBe(true);
    expect(r.count).toBe(1); // reads as "first request" -> caller allows
    expect(onError).toHaveBeenCalledOnce();
  });

  it("fails open on a non-2xx response", async () => {
    const f = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const s = createUpstashStore({ url: "https://x", token: "t", fetchImpl: f });
    expect((await s.hit("k", 60_000)).degraded).toBe(true);
  });

  it("fails open on a pipeline error entry", async () => {
    const f = vi.fn(async () =>
      new Response(JSON.stringify([{ error: "ERR bad" }, {}, {}]), { status: 200 }),
    ) as unknown as typeof fetch;
    const s = createUpstashStore({ url: "https://x", token: "t", fetchImpl: f });
    expect((await s.hit("k", 60_000)).degraded).toBe(true);
  });

  it("falls back to the full window when TTL is unset (-1)", async () => {
    const f = upstashOk(3, -1);
    const s = createUpstashStore({ url: "https://x", token: "t", fetchImpl: f });
    expect((await s.hit("k", 30_000)).resetSeconds).toBe(30);
  });
});

describe("resolveRateLimitStore", () => {
  it("uses upstash when both env vars are present", () => {
    expect(
      resolveRateLimitStore({
        UPSTASH_REDIS_REST_URL: "https://x",
        UPSTASH_REDIS_REST_TOKEN: "t",
      } as unknown as NodeJS.ProcessEnv).kind,
    ).toBe("upstash");
  });

  it("falls back to memory when unconfigured, so this ships safely ahead of provisioning", () => {
    expect(resolveRateLimitStore({} as unknown as NodeJS.ProcessEnv).kind).toBe("memory");
    expect(
      resolveRateLimitStore({ UPSTASH_REDIS_REST_URL: "https://x" } as unknown as NodeJS.ProcessEnv).kind,
    ).toBe("memory");
  });
});
