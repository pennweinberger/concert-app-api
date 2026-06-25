import { describe, it, expect, vi } from "vitest";
import { withIngestRun, detectTrigger } from "./ingestRun.js";

const fixedNow = new Date("2026-06-25T04:00:00.000Z");

function makeMockPrisma() {
  const create = vi.fn().mockResolvedValue({ id: "run_1" });
  const update = vi.fn().mockResolvedValue({});
  return {
    prisma: {
      ingestRun: { create, update },
    } as unknown as import("@prisma/client").PrismaClient,
    mocks: { create, update },
  };
}

// ---------------------------------------------------------------------------
// detectTrigger
// ---------------------------------------------------------------------------

describe("detectTrigger", () => {
  it("returns 'cron' when x-vercel-cron header is present", () => {
    expect(detectTrigger({ "x-vercel-cron": "1" })).toBe("cron");
  });
  it("returns 'manual' when the header is absent", () => {
    expect(detectTrigger({})).toBe("manual");
    expect(detectTrigger({ authorization: "Bearer x" })).toBe("manual");
  });
});

// ---------------------------------------------------------------------------
// withIngestRun — success path
// ---------------------------------------------------------------------------

describe("withIngestRun", () => {
  it("creates a running row, then updates to success with the summary", async () => {
    const { prisma, mocks } = makeMockPrisma();
    const summary = { processed: 7, actions: { AUTO_MERGE: 5 } };

    const result = await withIngestRun(
      { prisma, provider: "dice", trigger: "cron", now: () => fixedNow },
      async () => summary,
    );

    expect(result).toBe(summary);

    // create row with running status + provider + trigger
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.create.mock.calls[0]![0].data).toMatchObject({
      provider: "dice",
      trigger: "cron",
      status: "running",
    });

    // terminal update -> success, with summary stored
    expect(mocks.update).toHaveBeenCalledOnce();
    const upd = mocks.update.mock.calls[0]![0];
    expect(upd.where).toEqual({ id: "run_1" });
    expect(upd.data).toMatchObject({
      status: "success",
      durationMs: 0,
      summary,
    });
    expect(upd.data.finishedAt).toBeInstanceOf(Date);
  });

  it("records no-op runs too (empty-ish summary still stored)", async () => {
    const { prisma, mocks } = makeMockPrisma();
    const noop = { processed: 0, actions: {} };
    await withIngestRun(
      { prisma, provider: "bowery", trigger: "manual", now: () => fixedNow },
      async () => noop,
    );
    expect(mocks.update.mock.calls[0]![0].data.status).toBe("success");
    expect(mocks.update.mock.calls[0]![0].data.summary).toEqual(noop);
  });

  // ── error path ────────────────────────────────────────────────────
  it("on throw: writes status='error' with the message, then re-throws", async () => {
    const { prisma, mocks } = makeMockPrisma();
    const boom = new Error("feed 500");

    await expect(
      withIngestRun(
        { prisma, provider: "bowery", trigger: "cron", now: () => fixedNow },
        async () => {
          throw boom;
        },
      ),
    ).rejects.toThrow("feed 500");

    expect(mocks.update).toHaveBeenCalledOnce();
    const upd = mocks.update.mock.calls[0]![0];
    expect(upd.data).toMatchObject({ status: "error", error: "feed 500" });
    expect(upd.data.finishedAt).toBeInstanceOf(Date);
  });

  it("truncates very long error messages to 1000 chars", async () => {
    const { prisma, mocks } = makeMockPrisma();
    const longMsg = "x".repeat(5000);
    await expect(
      withIngestRun(
        { prisma, provider: "dice", trigger: "manual", now: () => fixedNow },
        async () => {
          throw new Error(longMsg);
        },
      ),
    ).rejects.toThrow();
    expect(mocks.update.mock.calls[0]![0].data.error.length).toBe(1000);
  });

  it("re-throws the ORIGINAL error even if the terminal update fails", async () => {
    // Simulates the DB being unreachable for the terminal write. The
    // original orchestrator error must still propagate (so the route's
    // 500 + Sentry path fires); the row is left at status='running'.
    const create = vi.fn().mockResolvedValue({ id: "run_x" });
    const update = vi.fn().mockRejectedValue(new Error("db gone"));
    const prisma = {
      ingestRun: { create, update },
    } as unknown as import("@prisma/client").PrismaClient;

    await expect(
      withIngestRun(
        { prisma, provider: "dice", trigger: "cron", now: () => fixedNow },
        async () => {
          throw new Error("original failure");
        },
      ),
    ).rejects.toThrow("original failure");
  });

  it("a thrown run leaves NO success update (stuck-running signal when create succeeds but update is skipped)", async () => {
    // Belt-and-suspenders: confirm we never write status='success' on
    // the error path. Combined with a failed terminal update, the row
    // stays 'running' — the timeout/killed signal.
    const { prisma, mocks } = makeMockPrisma();
    await expect(
      withIngestRun(
        { prisma, provider: "bowery", trigger: "cron", now: () => fixedNow },
        async () => {
          throw new Error("x");
        },
      ),
    ).rejects.toThrow();
    const statuses = mocks.update.mock.calls.map((c) => c[0].data.status);
    expect(statuses).not.toContain("success");
  });
});
