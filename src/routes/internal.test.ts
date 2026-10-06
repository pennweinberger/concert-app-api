import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerInternalRoutes } from "./internal.js";

// We mock setlistfmIngest's runIngestion so the test never reaches any
// real DB / external HTTP code. The route's job under test here is purely
// auth + inert behavior + invoking runIngestion when permitted.
vi.mock("../lib/setlistfmIngest.js", () => ({
  runIngestion: vi.fn(),
}));
import { runIngestion } from "../lib/setlistfmIngest.js";

// DICE health-check route tests: the orchestrator is mocked, and Sentry is
// replaced with spies so we can prove a failure is captured AND flushed.
vi.mock("../lib/diceIngest.js", () => ({ runDiceIngestion: vi.fn() }));
vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
  flush: vi.fn().mockResolvedValue(true),
}));
import { runDiceIngestion } from "../lib/diceIngest.js";
import * as Sentry from "@sentry/node";

function makeApp(): FastifyInstance {
  const app = Fastify();
  // The route handler only uses prisma by passing it to runIngestion
  // (which we've mocked above), so an empty object cast is sufficient
  // for these tests.
  registerInternalRoutes(app, {} as never);
  return app;
}

describe("POST /internal/ingest/setlistfm — auth + inert behavior", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CRON_SECRET;
    delete process.env.SETLISTFM_API_KEY;
    vi.mocked(runIngestion).mockReset();
  });

  it("503 when CRON_SECRET is not set", async () => {
    process.env.SETLISTFM_API_KEY = "k";
    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/ingest/setlistfm",
      headers: { authorization: "Bearer anything" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: "Ingestion not configured" });
    expect(runIngestion).not.toHaveBeenCalled();
  });

  it("503 when SETLISTFM_API_KEY is not set", async () => {
    process.env.CRON_SECRET = "s";
    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/ingest/setlistfm",
      headers: { authorization: "Bearer s" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: "Ingestion not configured" });
    expect(runIngestion).not.toHaveBeenCalled();
  });

  it("401 when both env vars set but no Authorization header", async () => {
    process.env.CRON_SECRET = "s";
    process.env.SETLISTFM_API_KEY = "k";
    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/ingest/setlistfm",
    });
    expect(res.statusCode).toBe(401);
    expect(runIngestion).not.toHaveBeenCalled();
  });

  it("401 when Authorization header has wrong bearer token", async () => {
    process.env.CRON_SECRET = "s";
    process.env.SETLISTFM_API_KEY = "k";
    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/ingest/setlistfm",
      headers: { authorization: "Bearer wrong" },
    });
    expect(res.statusCode).toBe(401);
    expect(runIngestion).not.toHaveBeenCalled();
  });

  it("401 when Authorization header is malformed (missing Bearer prefix)", async () => {
    process.env.CRON_SECRET = "s";
    process.env.SETLISTFM_API_KEY = "k";
    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/ingest/setlistfm",
      headers: { authorization: "s" },
    });
    expect(res.statusCode).toBe(401);
    expect(runIngestion).not.toHaveBeenCalled();
  });

  it("200 with summary when env vars set and bearer correct", async () => {
    process.env.CRON_SECRET = "s";
    process.env.SETLISTFM_API_KEY = "k";
    const fakeSummary = {
      processedArtists: 3,
      skippedArtistsNoMbid: 1,
      setlistsConsidered: 12,
      actions: { AUTO_MERGE: 1, CREATE_NEW: 8, REVIEW: 3 },
      errors: 0,
      rateLimitedDuringRun: false,
      durationMs: 1234,
    };
    vi.mocked(runIngestion).mockResolvedValueOnce(fakeSummary);

    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/ingest/setlistfm",
      headers: { authorization: "Bearer s" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(fakeSummary);
    expect(runIngestion).toHaveBeenCalledOnce();
  });

  it("500 when ingestion throws (still does not leak internals)", async () => {
    process.env.CRON_SECRET = "s";
    process.env.SETLISTFM_API_KEY = "k";
    vi.mocked(runIngestion).mockRejectedValueOnce(new Error("upstream boom"));

    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/ingest/setlistfm",
      headers: { authorization: "Bearer s" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({
      error: "Ingestion failed",
      details: "upstream boom",
    });
  });
});

describe("GET /internal/ingest/dice — health checks", () => {
  const originalEnv = { ...process.env };

  function makeDiceApp() {
    const ingestRun = {
      create: vi.fn().mockResolvedValue({ id: "run_1" }),
      update: vi.fn().mockResolvedValue({}),
    };
    const app = Fastify();
    registerInternalRoutes(app, { ingestRun } as never);
    return { app, ingestRun };
  }

  const baseSummary = {
    processedDiceVenues: 5,
    skippedRecentlyFetched: 0,
    eventsConsidered: 0,
    actions: { AUTO_MERGE: 0, CREATE_NEW: 0, REVIEW: 0 },
    errors: 0,
    rateLimitedDuringRun: false,
    durationMs: 8222,
    jsonLdEventsSeen: 0,
    driftPages: [] as { diceShortId: string; rawEventCount: number; rawEventTypes: string[] }[],
    activeVenuesWithZeroEvents: [] as string[],
    health: { status: "healthy" as "healthy" | "unhealthy", reasons: [] as string[] },
  };

  beforeEach(() => {
    process.env = { ...originalEnv, CRON_SECRET: "s", DICE_INGEST_ENABLED: "true" };
    vi.mocked(runDiceIngestion).mockReset();
    vi.mocked(Sentry.captureException).mockClear();
    vi.mocked(Sentry.flush).mockClear();
  });

  it("returns 200 and records success for a healthy run", async () => {
    vi.mocked(runDiceIngestion).mockResolvedValueOnce({ ...baseSummary, eventsConsidered: 12 } as never);
    const { app, ingestRun } = makeDiceApp();
    const res = await app.inject({
      method: "GET",
      url: "/internal/ingest/dice",
      headers: { authorization: "Bearer s" },
    });
    expect(res.statusCode).toBe(200);
    expect(ingestRun.update.mock.calls[0]![0].data.status).toBe("success");
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  /**
   * The September 2026 state: pages list events, the parser accepts none.
   * This must become a visible failure, keep its counts, and reach Sentry.
   */
  it("turns parser drift into a 500, keeps the counts, and reports to Sentry", async () => {
    const unhealthy = {
      ...baseSummary,
      jsonLdEventsSeen: 15,
      driftPages: [{ diceShortId: "8p85", rawEventCount: 15, rawEventTypes: ["Event"] }],
      health: { status: "unhealthy" as const, reasons: ["parser_drift"] },
    };
    vi.mocked(runDiceIngestion).mockResolvedValueOnce(unhealthy as never);
    const { app, ingestRun } = makeDiceApp();

    const res = await app.inject({
      method: "GET",
      url: "/internal/ingest/dice",
      headers: { authorization: "Bearer s" },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({
      error: "DICE ingestion unhealthy",
      reasons: ["parser_drift"],
      summary: { jsonLdEventsSeen: 15, eventsConsidered: 0 },
    });

    // IngestRun is "error" AND still holds the counts explaining it.
    const data = ingestRun.update.mock.calls[0]![0].data;
    expect(data.status).toBe("error");
    expect(data.summary).toMatchObject({ driftPages: unhealthy.driftPages });
    expect(data.error).toContain("parser_drift");

    // Captured once, grouped by reason, with the summary attached...
    expect(Sentry.captureException).toHaveBeenCalledOnce();
    const [err, ctx] = vi.mocked(Sentry.captureException).mock.calls[0]! as [Error, any];
    expect(err.name).toBe("DiceIngestHealthError");
    expect(ctx).toMatchObject({
      level: "error",
      tags: { provider: "dice", ingest_health: "parser_drift" },
      fingerprint: ["dice-ingest-health", "parser_drift"],
      extra: { summary: { jsonLdEventsSeen: 15 } },
    });
    // ...and flushed before responding, so a frozen serverless instance
    // cannot drop the event.
    expect(Sentry.flush).toHaveBeenCalledOnce();
    const flushOrder = vi.mocked(Sentry.flush).mock.invocationCallOrder[0]!;
    const captureOrder = vi.mocked(Sentry.captureException).mock.invocationCallOrder[0]!;
    expect(flushOrder).toBeGreaterThan(captureOrder);
  });

  it("still captures and flushes an ordinary ingestion error", async () => {
    vi.mocked(runDiceIngestion).mockRejectedValueOnce(new Error("db down"));
    const { app } = makeDiceApp();
    const res = await app.inject({
      method: "GET",
      url: "/internal/ingest/dice",
      headers: { authorization: "Bearer s" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: "DICE ingestion failed", details: "db down" });
    expect(Sentry.captureException).toHaveBeenCalledOnce();
    expect(Sentry.flush).toHaveBeenCalledOnce();
  });
});
