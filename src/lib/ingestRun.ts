// IngestRun audit log wrapper.
//
// Wraps an ingestion run (DICE / Bowery) at the route layer so every
// execution — cron, manual, success, failure, or no-op — leaves a row
// in the IngestRun table. The orchestrators stay pure (no IngestRun
// coupling), which keeps them unit-testable without mocking this.
//
// Lifecycle:
//   1. create row with status="running", startedAt=now
//   2a. fn() resolves    -> status="success", finishedAt, durationMs, summary
//   2b. fn() throws       -> status="error",   finishedAt, durationMs, error
//                            then re-throw so the caller's existing
//                            500 + Sentry handling is preserved.
//
// A row that stays at status="running" with a stale startedAt is the
// signal for a run that was killed mid-flight (e.g., the Vercel 300s
// function timeout) — we never get to write the terminal state.

import type { PrismaClient } from "@prisma/client";

export type IngestTrigger = "cron" | "manual";

export type WithIngestRunDeps = {
  prisma: PrismaClient;
  provider: string;
  trigger: IngestTrigger;
  now?: () => Date;
};

// Vercel Cron attaches this header to scheduled invocations. Anything
// without it is treated as a manual trigger (curl, ops script).
export function detectTrigger(headers: Record<string, unknown>): IngestTrigger {
  return headers["x-vercel-cron"] ? "cron" : "manual";
}

export async function withIngestRun<T>(
  deps: WithIngestRunDeps,
  fn: () => Promise<T>,
): Promise<T> {
  const now = deps.now ?? (() => new Date());
  const startMs = now().getTime();

  const run = await deps.prisma.ingestRun.create({
    data: {
      provider: deps.provider,
      trigger: deps.trigger,
      status: "running",
    },
    select: { id: true },
  });

  try {
    const result = await fn();
    await deps.prisma.ingestRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        finishedAt: now(),
        durationMs: now().getTime() - startMs,
        // The orchestrator summary is a plain object — store as JSON.
        summary: (result ?? null) as object,
      },
    });
    return result;
  } catch (err: any) {
    // Best-effort terminal write. If THIS update itself fails we still
    // re-throw the original error — the route's 500 + Sentry path is
    // what matters, and the row stays "running" (timeout-style signal).
    try {
      await deps.prisma.ingestRun.update({
        where: { id: run.id },
        data: {
          status: "error",
          finishedAt: now(),
          durationMs: now().getTime() - startMs,
          error: (err?.message ?? String(err)).slice(0, 1000),
        },
      });
    } catch {
      // swallow — original error is the important one
    }
    throw err;
  }
}
