// Abuse reports + moderation actions. Pure-ish functions with an
// injected Prisma client so the HTTP routes stay thin and the logic is
// unit-testable. Philosophy: make abuse easy for an admin to find and
// remove — no automated enforcement.

import type { PrismaClient } from "@prisma/client";

export const REPORT_TARGET_TYPES = ["REVIEW", "COMMENT", "USER"] as const;
export type ReportTargetTypeT = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_REASONS = [
  "SPAM",
  "HARASSMENT",
  "HATE_SPEECH",
  "INAPPROPRIATE_CONTENT",
  "FAKE_REVIEW",
  "IMPERSONATION",
  "OTHER",
] as const;
export type ReportReasonT = (typeof REPORT_REASONS)[number];

const MAX_DETAILS = 1000;

// ---------------------------------------------------------------------------
// createReport — validation + self-report guard + dedup
// ---------------------------------------------------------------------------

export type CreateReportInput = {
  reporterUserId: string;
  targetType: string;
  targetId: string;
  reason: string;
  details?: string | null;
};

export type CreateReportResult =
  | { ok: true; alreadyReported: boolean }
  | {
      ok: false;
      reason:
        | "invalid_target_type"
        | "invalid_reason"
        | "target_not_found"
        | "self_report";
    };

// Returns the userId that OWNS a target (review author, comment author,
// or the user themselves), or null if the target does not exist.
async function resolveTargetAuthorId(
  targetType: ReportTargetTypeT,
  targetId: string,
  prisma: PrismaClient,
): Promise<string | null> {
  if (targetType === "REVIEW") {
    const r = await prisma.review.findUnique({
      where: { id: targetId },
      select: { userId: true },
    });
    return r?.userId ?? null;
  }
  if (targetType === "COMMENT") {
    const c = await prisma.reviewComment.findUnique({
      where: { id: targetId },
      select: { userId: true },
    });
    return c?.userId ?? null;
  }
  // USER — the target is the user; existence check + self-report use the id.
  const u = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true },
  });
  return u?.id ?? null;
}

export async function createReport(
  input: CreateReportInput,
  deps: { prisma: PrismaClient },
): Promise<CreateReportResult> {
  if (!REPORT_TARGET_TYPES.includes(input.targetType as ReportTargetTypeT)) {
    return { ok: false, reason: "invalid_target_type" };
  }
  if (!REPORT_REASONS.includes(input.reason as ReportReasonT)) {
    return { ok: false, reason: "invalid_reason" };
  }
  const targetType = input.targetType as ReportTargetTypeT;

  const authorId = await resolveTargetAuthorId(
    targetType,
    input.targetId,
    deps.prisma,
  );
  if (authorId === null) {
    return { ok: false, reason: "target_not_found" };
  }
  if (authorId === input.reporterUserId) {
    return { ok: false, reason: "self_report" };
  }

  const details =
    typeof input.details === "string" && input.details.trim()
      ? input.details.trim().slice(0, MAX_DETAILS)
      : null;

  try {
    await deps.prisma.report.create({
      data: {
        reporterUserId: input.reporterUserId,
        targetType,
        targetId: input.targetId,
        reason: input.reason as ReportReasonT,
        details,
      },
    });
    return { ok: true, alreadyReported: false };
  } catch (e: any) {
    // Unique (reporter, targetType, targetId) — already reported. Report
    // once per target; treat a repeat as a successful no-op.
    if (e?.code === "P2002") {
      return { ok: true, alreadyReported: true };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// listOpenReportsGrouped — admin queue, one item per target
// ---------------------------------------------------------------------------

export type ModerationQueueItem = {
  targetType: ReportTargetTypeT;
  targetId: string;
  reportCount: number;
  reasons: { reason: ReportReasonT; count: number }[];
  detailsSamples: string[];
  firstReportedAt: string;
  lastReportedAt: string;
  // Hydrated target (null if since-deleted), plus author + a link.
  content:
    | { kind: "review"; text: string; blocked: boolean }
    | { kind: "comment"; body: string; blocked: boolean }
    | { kind: "user"; handle: string; name: string | null; suspended: boolean }
    | null;
  author: { id: string; handle: string; name: string | null } | null;
  link: string | null;
};

const MAX_OPEN_REPORTS_SCAN = 500;

export async function listOpenReportsGrouped(
  deps: { prisma: PrismaClient },
): Promise<ModerationQueueItem[]> {
  const reports = await deps.prisma.report.findMany({
    where: { status: "OPEN" },
    orderBy: { createdAt: "desc" },
    take: MAX_OPEN_REPORTS_SCAN,
  });

  // Group by targetType|targetId.
  const groups = new Map<string, typeof reports>();
  for (const r of reports) {
    const key = `${r.targetType}|${r.targetId}`;
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }

  const items: ModerationQueueItem[] = [];
  for (const [, group] of groups) {
    const first = group[0]!;
    const targetType = first.targetType as ReportTargetTypeT;
    const targetId = first.targetId;

    const reasonCounts = new Map<string, number>();
    const details: string[] = [];
    let min = group[0]!.createdAt;
    let max = group[0]!.createdAt;
    for (const r of group) {
      reasonCounts.set(r.reason, (reasonCounts.get(r.reason) ?? 0) + 1);
      if (r.details) details.push(r.details);
      if (r.createdAt < min) min = r.createdAt;
      if (r.createdAt > max) max = r.createdAt;
    }

    const { content, author, link } = await hydrateTarget(
      targetType,
      targetId,
      deps.prisma,
    );

    items.push({
      targetType,
      targetId,
      reportCount: group.length,
      reasons: [...reasonCounts.entries()].map(([reason, count]) => ({
        reason: reason as ReportReasonT,
        count,
      })),
      detailsSamples: details.slice(0, 5),
      firstReportedAt: min.toISOString(),
      lastReportedAt: max.toISOString(),
      content,
      author,
      link,
    });
  }

  // Most-recently-active groups first.
  items.sort((a, b) => (a.lastReportedAt < b.lastReportedAt ? 1 : -1));
  return items;
}

async function hydrateTarget(
  targetType: ReportTargetTypeT,
  targetId: string,
  prisma: PrismaClient,
): Promise<Pick<ModerationQueueItem, "content" | "author" | "link">> {
  if (targetType === "REVIEW") {
    const r = await prisma.review.findUnique({
      where: { id: targetId },
      select: {
        reviewTextRaw: true,
        showId: true,
        moderationStatus: true,
        user: { select: { id: true, handle: true, name: true } },
      },
    });
    if (!r) return { content: null, author: null, link: null };
    return {
      content: {
        kind: "review",
        text: r.reviewTextRaw,
        blocked: r.moderationStatus === "BLOCKED",
      },
      author: r.user,
      link: `/show/${r.showId}`,
    };
  }
  if (targetType === "COMMENT") {
    const c = await prisma.reviewComment.findUnique({
      where: { id: targetId },
      select: {
        body: true,
        moderationStatus: true,
        review: { select: { showId: true } },
        user: { select: { id: true, handle: true, name: true } },
      },
    });
    if (!c) return { content: null, author: null, link: null };
    return {
      content: {
        kind: "comment",
        body: c.body,
        blocked: c.moderationStatus === "BLOCKED",
      },
      author: c.user,
      link: c.review ? `/show/${c.review.showId}` : null,
    };
  }
  // USER
  const u = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, handle: true, name: true, suspendedAt: true },
  });
  if (!u) return { content: null, author: null, link: null };
  return {
    content: {
      kind: "user",
      handle: u.handle,
      name: u.name,
      suspended: u.suspendedAt !== null,
    },
    author: { id: u.id, handle: u.handle, name: u.name },
    link: `/user/${u.handle}`,
  };
}

// ---------------------------------------------------------------------------
// Moderation actions
// ---------------------------------------------------------------------------

export type ActionResult = { ok: true } | { ok: false; reason: string };

// Block a review/comment and resolve all open reports on it to ACTIONED.
export async function blockContent(
  targetType: "REVIEW" | "COMMENT",
  targetId: string,
  adminId: string,
  deps: { prisma: PrismaClient; now: () => Date },
): Promise<ActionResult> {
  const now = deps.now();
  if (targetType === "REVIEW") {
    const r = await deps.prisma.review.findUnique({
      where: { id: targetId },
      select: { id: true },
    });
    if (!r) return { ok: false, reason: "target_not_found" };
    await deps.prisma.review.update({
      where: { id: targetId },
      data: { moderationStatus: "BLOCKED" },
    });
  } else {
    const c = await deps.prisma.reviewComment.findUnique({
      where: { id: targetId },
      select: { id: true },
    });
    if (!c) return { ok: false, reason: "target_not_found" };
    await deps.prisma.reviewComment.update({
      where: { id: targetId },
      data: { moderationStatus: "BLOCKED" },
    });
  }
  await resolveOpenReports(targetType, targetId, "ACTIONED", adminId, now, deps.prisma);
  return { ok: true };
}

export async function restoreContent(
  targetType: "REVIEW" | "COMMENT",
  targetId: string,
  deps: { prisma: PrismaClient },
): Promise<ActionResult> {
  if (targetType === "REVIEW") {
    const r = await deps.prisma.review.findUnique({
      where: { id: targetId },
      select: { id: true },
    });
    if (!r) return { ok: false, reason: "target_not_found" };
    await deps.prisma.review.update({
      where: { id: targetId },
      data: { moderationStatus: "ALLOWED" },
    });
  } else {
    const c = await deps.prisma.reviewComment.findUnique({
      where: { id: targetId },
      select: { id: true },
    });
    if (!c) return { ok: false, reason: "target_not_found" };
    await deps.prisma.reviewComment.update({
      where: { id: targetId },
      data: { moderationStatus: "ALLOWED" },
    });
  }
  return { ok: true };
}

export async function dismissReport(
  reportId: string,
  adminId: string,
  deps: { prisma: PrismaClient; now: () => Date },
): Promise<ActionResult> {
  const res = await deps.prisma.report.updateMany({
    where: { id: reportId, status: "OPEN" },
    data: { status: "DISMISSED", resolvedAt: deps.now(), resolvedByUserId: adminId },
  });
  if (res.count === 0) return { ok: false, reason: "not_found_or_resolved" };
  return { ok: true };
}

export async function dismissTarget(
  targetType: ReportTargetTypeT,
  targetId: string,
  adminId: string,
  deps: { prisma: PrismaClient; now: () => Date },
): Promise<ActionResult> {
  await resolveOpenReports(targetType, targetId, "DISMISSED", adminId, deps.now(), deps.prisma);
  return { ok: true };
}

export async function suspendUser(
  userId: string,
  reason: string | null,
  adminId: string,
  deps: { prisma: PrismaClient; now: () => Date },
): Promise<ActionResult> {
  const u = await deps.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!u) return { ok: false, reason: "user_not_found" };
  const now = deps.now();
  await deps.prisma.user.update({
    where: { id: userId },
    data: {
      suspendedAt: now,
      suspensionReason: reason && reason.trim() ? reason.trim().slice(0, 1000) : null,
    },
  });
  // Resolve open USER reports against this user.
  await resolveOpenReports("USER", userId, "ACTIONED", adminId, now, deps.prisma);
  return { ok: true };
}

export async function unsuspendUser(
  userId: string,
  deps: { prisma: PrismaClient },
): Promise<ActionResult> {
  const u = await deps.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!u) return { ok: false, reason: "user_not_found" };
  await deps.prisma.user.update({
    where: { id: userId },
    data: { suspendedAt: null, suspensionReason: null },
  });
  return { ok: true };
}

async function resolveOpenReports(
  targetType: ReportTargetTypeT,
  targetId: string,
  status: "ACTIONED" | "DISMISSED",
  adminId: string,
  now: Date,
  prisma: PrismaClient,
): Promise<void> {
  await prisma.report.updateMany({
    where: { targetType, targetId, status: "OPEN" },
    data: { status, resolvedAt: now, resolvedByUserId: adminId },
  });
}
