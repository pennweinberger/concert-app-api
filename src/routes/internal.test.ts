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
