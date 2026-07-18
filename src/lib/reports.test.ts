import { describe, it, expect, vi } from "vitest";
import {
  createReport,
  blockContent,
  restoreContent,
  dismissReport,
  dismissTarget,
  suspendUser,
  unsuspendUser,
  listOpenReportsGrouped,
} from "./reports.js";

const now = new Date("2026-07-18T12:00:00.000Z");

function prismaMock(overrides: any = {}) {
  return {
    review: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    reviewComment: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    user: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    report: {
      create: vi.fn().mockResolvedValue({ id: "rep_1" }),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(0),
    },
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// createReport
// ---------------------------------------------------------------------------

describe("createReport", () => {
  it("rejects an invalid target type", async () => {
    const prisma = prismaMock();
    const r = await createReport(
      { reporterUserId: "u1", targetType: "SHOW", targetId: "x", reason: "SPAM" },
      { prisma },
    );
    expect(r).toEqual({ ok: false, reason: "invalid_target_type" });
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid reason", async () => {
    const prisma = prismaMock();
    const r = await createReport(
      { reporterUserId: "u1", targetType: "REVIEW", targetId: "x", reason: "NONSENSE" },
      { prisma },
    );
    expect(r).toEqual({ ok: false, reason: "invalid_reason" });
  });

  it("404s when the target review does not exist", async () => {
    const prisma = prismaMock();
    prisma.review.findUnique.mockResolvedValue(null);
    const r = await createReport(
      { reporterUserId: "u1", targetType: "REVIEW", targetId: "ghost", reason: "SPAM" },
      { prisma },
    );
    expect(r).toEqual({ ok: false, reason: "target_not_found" });
  });

  it("blocks self-reporting your own review", async () => {
    const prisma = prismaMock();
    prisma.review.findUnique.mockResolvedValue({ userId: "u1" });
    const r = await createReport(
      { reporterUserId: "u1", targetType: "REVIEW", targetId: "r1", reason: "SPAM" },
      { prisma },
    );
    expect(r).toEqual({ ok: false, reason: "self_report" });
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it("blocks self-reporting your own USER profile", async () => {
    const prisma = prismaMock();
    prisma.user.findUnique.mockResolvedValue({ id: "u1" });
    const r = await createReport(
      { reporterUserId: "u1", targetType: "USER", targetId: "u1", reason: "IMPERSONATION" },
      { prisma },
    );
    expect(r).toEqual({ ok: false, reason: "self_report" });
  });

  it("creates a report for another user's review, trimming details", async () => {
    const prisma = prismaMock();
    prisma.review.findUnique.mockResolvedValue({ userId: "author" });
    const r = await createReport(
      {
        reporterUserId: "u1",
        targetType: "REVIEW",
        targetId: "r1",
        reason: "OTHER",
        details: "  spammy link  ",
      },
      { prisma },
    );
    expect(r).toEqual({ ok: true, alreadyReported: false });
    expect(prisma.report.create.mock.calls[0][0].data).toMatchObject({
      reporterUserId: "u1",
      targetType: "REVIEW",
      targetId: "r1",
      reason: "OTHER",
      details: "spammy link",
    });
  });

  it("treats a duplicate report (P2002) as a successful no-op", async () => {
    const prisma = prismaMock();
    prisma.review.findUnique.mockResolvedValue({ userId: "author" });
    prisma.report.create.mockRejectedValue({ code: "P2002" });
    const r = await createReport(
      { reporterUserId: "u1", targetType: "REVIEW", targetId: "r1", reason: "SPAM" },
      { prisma },
    );
    expect(r).toEqual({ ok: true, alreadyReported: true });
  });
});

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

describe("moderation actions", () => {
  it("blockContent sets BLOCKED and resolves open reports to ACTIONED", async () => {
    const prisma = prismaMock();
    prisma.review.findUnique.mockResolvedValue({ id: "r1" });
    const res = await blockContent("REVIEW", "r1", "admin1", { prisma, now: () => now });
    expect(res).toEqual({ ok: true });
    expect(prisma.review.update.mock.calls[0][0].data).toEqual({ moderationStatus: "BLOCKED" });
    expect(prisma.report.updateMany.mock.calls[0][0]).toMatchObject({
      where: { targetType: "REVIEW", targetId: "r1", status: "OPEN" },
      data: { status: "ACTIONED", resolvedByUserId: "admin1" },
    });
  });

  it("blockContent 404s when target missing", async () => {
    const prisma = prismaMock();
    prisma.reviewComment.findUnique.mockResolvedValue(null);
    const res = await blockContent("COMMENT", "ghost", "admin1", { prisma, now: () => now });
    expect(res).toEqual({ ok: false, reason: "target_not_found" });
  });

  it("restoreContent sets ALLOWED and does NOT touch reports", async () => {
    const prisma = prismaMock();
    prisma.review.findUnique.mockResolvedValue({ id: "r1" });
    const res = await restoreContent("REVIEW", "r1", { prisma });
    expect(res).toEqual({ ok: true });
    expect(prisma.review.update.mock.calls[0][0].data).toEqual({ moderationStatus: "ALLOWED" });
    expect(prisma.report.updateMany).not.toHaveBeenCalled();
  });

  it("dismissReport dismisses a single open report", async () => {
    const prisma = prismaMock();
    const res = await dismissReport("rep_1", "admin1", { prisma, now: () => now });
    expect(res).toEqual({ ok: true });
    expect(prisma.report.updateMany.mock.calls[0][0].where).toMatchObject({
      id: "rep_1",
      status: "OPEN",
    });
  });

  it("dismissReport 404s when nothing was open to dismiss", async () => {
    const prisma = prismaMock();
    prisma.report.updateMany.mockResolvedValue({ count: 0 });
    const res = await dismissReport("rep_x", "admin1", { prisma, now: () => now });
    expect(res).toEqual({ ok: false, reason: "not_found_or_resolved" });
  });

  it("dismissTarget dismisses all open reports for a target", async () => {
    const prisma = prismaMock();
    const res = await dismissTarget("COMMENT", "c1", "admin1", { prisma, now: () => now });
    expect(res).toEqual({ ok: true });
    expect(prisma.report.updateMany.mock.calls[0][0]).toMatchObject({
      where: { targetType: "COMMENT", targetId: "c1", status: "OPEN" },
      data: { status: "DISMISSED" },
    });
  });

  it("suspendUser sets suspendedAt + resolves open USER reports", async () => {
    const prisma = prismaMock();
    prisma.user.findUnique.mockResolvedValue({ id: "u2" });
    const res = await suspendUser("u2", "spamming", "admin1", { prisma, now: () => now });
    expect(res).toEqual({ ok: true });
    expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({
      suspendedAt: now,
      suspensionReason: "spamming",
    });
    expect(prisma.report.updateMany.mock.calls[0][0].where).toMatchObject({
      targetType: "USER",
      targetId: "u2",
      status: "OPEN",
    });
  });

  it("unsuspendUser clears suspension", async () => {
    const prisma = prismaMock();
    prisma.user.findUnique.mockResolvedValue({ id: "u2" });
    const res = await unsuspendUser("u2", { prisma });
    expect(res).toEqual({ ok: true });
    expect(prisma.user.update.mock.calls[0][0].data).toEqual({
      suspendedAt: null,
      suspensionReason: null,
    });
  });
});

// ---------------------------------------------------------------------------
// listOpenReportsGrouped
// ---------------------------------------------------------------------------

describe("listOpenReportsGrouped", () => {
  it("groups multiple reports on one target into a single item with counts", async () => {
    const prisma = prismaMock();
    prisma.report.findMany.mockResolvedValue([
      { targetType: "REVIEW", targetId: "r1", reason: "SPAM", details: null, createdAt: new Date("2026-07-18T10:00:00Z") },
      { targetType: "REVIEW", targetId: "r1", reason: "SPAM", details: "x", createdAt: new Date("2026-07-18T11:00:00Z") },
      { targetType: "REVIEW", targetId: "r1", reason: "HARASSMENT", details: null, createdAt: new Date("2026-07-18T09:00:00Z") },
    ]);
    prisma.review.findUnique.mockResolvedValue({
      reviewTextRaw: "bad review",
      showId: "s1",
      moderationStatus: "ALLOWED",
      user: { id: "author", handle: "author", name: "Author" },
    });

    const items = await listOpenReportsGrouped({ prisma });
    expect(items).toHaveLength(1);
    const it0 = items[0]!;
    expect(it0.targetId).toBe("r1");
    expect(it0.reportCount).toBe(3);
    expect(it0.reasons).toEqual(
      expect.arrayContaining([
        { reason: "SPAM", count: 2 },
        { reason: "HARASSMENT", count: 1 },
      ]),
    );
    expect(it0.firstReportedAt).toBe("2026-07-18T09:00:00.000Z");
    expect(it0.lastReportedAt).toBe("2026-07-18T11:00:00.000Z");
    expect(it0.content).toMatchObject({ kind: "review", text: "bad review", blocked: false });
    expect(it0.link).toBe("/show/s1");
  });

  it("renders a since-deleted target as null content", async () => {
    const prisma = prismaMock();
    prisma.report.findMany.mockResolvedValue([
      { targetType: "COMMENT", targetId: "gone", reason: "SPAM", details: null, createdAt: new Date() },
    ]);
    prisma.reviewComment.findUnique.mockResolvedValue(null);
    const items = await listOpenReportsGrouped({ prisma });
    expect(items[0]!.content).toBeNull();
    expect(items[0]!.author).toBeNull();
  });
});
