// Account lifecycle — pure handler functions for soft-delete request,
// confirmation, cancellation, and the post-grace anonymization sweep.
//
// Anonymization (NOT cascade-delete) is the design — Afterset's value
// is the archive of reviews, so on hard-delete we strip PII from the
// User row but keep the row + its FK relationships. Reviews, likes,
// attendances all continue to point at the row; only the row's
// identity is gone. The frontend detects the `_deleted_<id-suffix>`
// handle prefix and renders these contributors as "[deleted user]".

import type { PrismaClient } from "@prisma/client";
import { generateTokenString, tokenExpiresAt, checkToken } from "./tokens.js";
import type { EmailSendResult } from "./email.js";

const GRACE_DAYS = 30;
const ANONYMIZED_HANDLE_PREFIX = "_deleted_";

// Deterministic per user-id, using the WHOLE id. Uniqueness here is not
// cosmetic: `handle` is @unique, so a duplicate aborts the anonymizing
// transaction, which aborts the whole sweep — every remaining due user
// included — and does so again on every subsequent nightly run.
//
// This previously used `userId.slice(0, 8)`. A cuid's first 8 chars are
// "c" plus 7 of its 8 base36 timestamp chars, so they only change every
// ~14ms: 2000 ids generated in a burst yield 2 distinct prefixes. Any two
// accounts created in the same instant — batch imports, a bot signup
// burst — would have collided and permanently stalled deletions.
//
// The full id is the primary key, so collisions are impossible. It is
// also 34 chars, which exceeds the 20-char registration limit, so unlike
// the 17-char short form nobody can squat a tombstone handle to poison a
// future deletion. Handles are never rendered raw — the frontend matches
// the prefix and shows "[deleted user]" — so the extra length is unseen.
export function anonymizedHandleFor(userId: string): string {
  return `${ANONYMIZED_HANDLE_PREFIX}${userId}`;
}

export function isAnonymizedHandle(handle: string): boolean {
  return handle.startsWith(ANONYMIZED_HANDLE_PREFIX);
}

export function deletionScheduledFor(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + GRACE_DAYS * 24 * 60 * 60_000);
}

// ---------------------------------------------------------------------------
// requestAccountDelete
// ---------------------------------------------------------------------------

export type RequestDeleteDeps = {
  prisma: PrismaClient;
  sendAccountDeleteConfirmEmail: (opts: {
    to: string;
    handle: string;
    token: string;
  }) => Promise<EmailSendResult>;
  now: () => Date;
};

export type RequestDeleteResult =
  | { ok: true; emailAttempted: boolean }
  | { ok: false; reason: "already_pending" | "anonymized" | "no_email" };

export async function requestAccountDelete(
  input: { userId: string },
  deps: RequestDeleteDeps,
): Promise<RequestDeleteResult> {
  const user = await deps.prisma.user.findUnique({
    where: { id: input.userId },
  });
  if (!user) {
    // Treat unknown user same as anonymized — defensive.
    return { ok: false, reason: "anonymized" };
  }
  if (user.anonymizedAt) {
    return { ok: false, reason: "anonymized" };
  }
  if (user.deletedAt) {
    return { ok: false, reason: "already_pending" };
  }
  if (!user.email) {
    // The confirmation flow runs through email. A user without an
    // email on file can't be served by it. These are the pre-Phase 1
    // accounts; a separate recovery path is out of scope.
    return { ok: false, reason: "no_email" };
  }

  const now = deps.now();

  // Invalidate prior un-consumed account_delete tokens.
  await deps.prisma.verificationToken.updateMany({
    where: {
      userId: user.id,
      type: "account_delete",
      consumedAt: null,
    },
    data: { consumedAt: now },
  });

  const created = await deps.prisma.verificationToken.create({
    data: {
      userId: user.id,
      type: "account_delete",
      token: generateTokenString(),
      expiresAt: tokenExpiresAt("account_delete", now),
    },
  });

  const send = await deps.sendAccountDeleteConfirmEmail({
    to: user.email,
    handle: user.handle,
    token: created.token,
  });

  return { ok: true, emailAttempted: send.sent };
}

// ---------------------------------------------------------------------------
// confirmAccountDelete
// ---------------------------------------------------------------------------

export type ConfirmDeleteDeps = {
  prisma: PrismaClient;
  now: () => Date;
};

export type ConfirmDeleteResult =
  | { ok: true; deletionScheduledFor: Date }
  | {
      ok: false;
      reason: "invalid_token" | "expired" | "consumed" | "anonymized";
    };

export async function confirmAccountDelete(
  input: { token: string },
  deps: ConfirmDeleteDeps,
): Promise<ConfirmDeleteResult> {
  const record = await deps.prisma.verificationToken.findUnique({
    where: { token: input.token },
    include: { user: { select: { id: true, anonymizedAt: true, deletedAt: true } } },
  });

  const validity = checkToken({
    record: record
      ? {
          type: record.type,
          expiresAt: record.expiresAt,
          consumedAt: record.consumedAt,
        }
      : null,
    expectedType: "account_delete",
    now: deps.now(),
  });

  if (!validity.ok) {
    if (
      validity.reason === "not_found" ||
      validity.reason === "wrong_type"
    ) {
      return { ok: false, reason: "invalid_token" };
    }
    return { ok: false, reason: validity.reason };
  }
  if (!record) return { ok: false, reason: "invalid_token" };
  if (record.user.anonymizedAt) {
    return { ok: false, reason: "anonymized" };
  }

  const now = deps.now();

  await deps.prisma.$transaction([
    deps.prisma.user.update({
      where: { id: record.userId },
      // Don't clobber an existing deletedAt — if the user requested
      // deletion twice and confirmed the second, the first deletedAt
      // is still the canonical start of the grace period.
      data: record.user.deletedAt
        ? {}
        : { deletedAt: now },
    }),
    deps.prisma.verificationToken.update({
      where: { id: record.id },
      data: { consumedAt: now },
    }),
  ]);

  const effectiveDeletedAt = record.user.deletedAt ?? now;
  return {
    ok: true,
    deletionScheduledFor: deletionScheduledFor(effectiveDeletedAt),
  };
}

// ---------------------------------------------------------------------------
// cancelAccountDelete
// ---------------------------------------------------------------------------

export type CancelDeleteDeps = {
  prisma: PrismaClient;
};

export type CancelDeleteResult =
  | { ok: true }
  | { ok: false; reason: "no_pending" | "anonymized" };

export async function cancelAccountDelete(
  input: { userId: string },
  deps: CancelDeleteDeps,
): Promise<CancelDeleteResult> {
  const user = await deps.prisma.user.findUnique({
    where: { id: input.userId },
  });
  if (!user || user.anonymizedAt) {
    return { ok: false, reason: "anonymized" };
  }
  if (!user.deletedAt) {
    return { ok: false, reason: "no_pending" };
  }
  await deps.prisma.user.update({
    where: { id: user.id },
    data: { deletedAt: null },
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// cleanupAccountDeletions — internal cron handler
// ---------------------------------------------------------------------------

export type CleanupDeps = {
  prisma: PrismaClient;
  now: () => Date;
  /** Batch size cap to bound a single run. */
  limit?: number;
};

export type CleanupResult = {
  anonymized: number;
  followsDeleted: number;
};

export async function cleanupAccountDeletions(
  deps: CleanupDeps,
): Promise<CleanupResult> {
  const now = deps.now();
  const cutoff = new Date(now.getTime() - GRACE_DAYS * 24 * 60 * 60_000);
  const limit = deps.limit ?? 100;

  const due = await deps.prisma.user.findMany({
    where: {
      deletedAt: { lt: cutoff, not: null },
      anonymizedAt: null,
    },
    select: { id: true },
    take: limit,
  });

  let anonymized = 0;
  let followsDeleted = 0;

  for (const u of due) {
    // Anonymize in a single transaction per user. Follow rows
    // representing the active identity get deleted; reviews, likes,
    // attendances stay.
    const result = await deps.prisma.$transaction(async (tx) => {
      const f1 = await tx.follow.deleteMany({
        where: { followerId: u.id },
      });
      const f2 = await tx.follow.deleteMany({
        where: { followingId: u.id },
      });
      await tx.user.update({
        where: { id: u.id },
        data: {
          email: null,
          emailVerifiedAt: null,
          passwordHash: null,
          name: null,
          avatarUrl: null,
          handle: anonymizedHandleFor(u.id),
          anonymizedAt: now,
        },
      });
      return { follows: f1.count + f2.count };
    });
    anonymized++;
    followsDeleted += result.follows;
  }

  return { anonymized, followsDeleted };
}
