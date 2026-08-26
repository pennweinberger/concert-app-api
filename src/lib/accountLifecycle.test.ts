import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  anonymizedHandleFor,
  isAnonymizedHandle,
  deletionScheduledFor,
  requestAccountDelete,
  confirmAccountDelete,
  cancelAccountDelete,
  cleanupAccountDeletions,
} from "./accountLifecycle.js";

const fixedNow = new Date("2026-06-19T12:00:00.000Z");
const GRACE_MS = 30 * 24 * 60 * 60_000;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("anonymizedHandleFor", () => {
  it("uses _deleted_<full-user-id>", () => {
    expect(anonymizedHandleFor("cm12345678abcdef")).toBe(
      "_deleted_cm12345678abcdef",
    );
  });

  /**
   * Regression. This previously truncated to the first 8 chars, and the
   * old version of this test compared "idAaaaaaaaa" to "idBbbbbbbbb" —
   * ids that differ inside the truncation, so it passed while the bug was
   * live. Real cuids share their leading chars: they are "c" plus base36
   * ms, so the first 8 chars only change every ~14ms.
   *
   * `handle` is @unique, so a collision aborts the sweep's transaction and
   * with it every remaining user in the batch — permanently, since the
   * same pair is retried every night.
   */
  it("does not collide for ids that share their first 8 characters", () => {
    // Two cuids from the same millisecond — a realistic pair of accounts
    // created in one batch import or signup burst.
    const a = "cmt9jry0q00001dn1aaad0ek6";
    const b = "cmt9jry0q00021dn1zzzc9xy4";
    expect(a.slice(0, 8)).toBe(b.slice(0, 8)); // the old key was identical
    expect(anonymizedHandleFor(a)).not.toBe(anonymizedHandleFor(b));
  });

  /**
   * Registration allows a leading underscore (/^[a-zA-Z0-9_]{3,20}$/), so
   * the only thing stopping someone reserving a tombstone handle and
   * blocking a future deletion is that the real one is too long to
   * register.
   */
  it("is longer than a registerable handle, so it cannot be squatted", () => {
    const handle = anonymizedHandleFor("cmt9jry0q00001dn1aaad0ek6");
    expect(handle.length).toBeGreaterThan(20);
    expect(/^[a-zA-Z0-9_]{3,20}$/.test(handle)).toBe(false);
  });
});

describe("isAnonymizedHandle", () => {
  it("returns true for _deleted_ prefix", () => {
    expect(isAnonymizedHandle("_deleted_cm12abcd")).toBe(true);
  });
  it("returns false for normal handles", () => {
    expect(isAnonymizedHandle("penn")).toBe(false);
    expect(isAnonymizedHandle("user_with_underscores")).toBe(false);
  });
});

describe("deletionScheduledFor", () => {
  it("returns deletedAt + 30 days", () => {
    const deletedAt = new Date("2026-06-01T00:00:00.000Z");
    const scheduled = deletionScheduledFor(deletedAt);
    expect(scheduled.getTime() - deletedAt.getTime()).toBe(GRACE_MS);
  });
});

// ---------------------------------------------------------------------------
// Mock Prisma factory
// ---------------------------------------------------------------------------

function makeMockPrisma() {
  const findUserUnique = vi.fn();
  const updateUser = vi.fn().mockResolvedValue({});
  const findManyUsers = vi.fn();
  const findTokenUnique = vi.fn();
  const createToken = vi.fn();
  const updateToken = vi.fn().mockResolvedValue({});
  const updateManyTokens = vi.fn().mockResolvedValue({ count: 0 });
  const deleteManyFollows = vi.fn().mockResolvedValue({ count: 0 });
  // Archive tables. Present only so a test can assert the sweep never
  // touches them — retaining this content is a deliberate product
  // decision, not an oversight.
  const deleteManyReviews = vi.fn().mockResolvedValue({ count: 0 });
  const deleteManyReviewLikes = vi.fn().mockResolvedValue({ count: 0 });
  const deleteManyReviewComments = vi.fn().mockResolvedValue({ count: 0 });
  const deleteManyAttendances = vi.fn().mockResolvedValue({ count: 0 });

  const txClient = {
    user: { update: updateUser },
    follow: { deleteMany: deleteManyFollows },
    review: { deleteMany: deleteManyReviews },
    reviewLike: { deleteMany: deleteManyReviewLikes },
    reviewComment: { deleteMany: deleteManyReviewComments },
    attendance: { deleteMany: deleteManyAttendances },
  };

  const $transaction = vi.fn().mockImplementation(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    if (typeof arg === "function") {
      return (arg as (t: typeof txClient) => Promise<unknown>)(txClient);
    }
    throw new Error("unexpected $transaction arg shape");
  });

  return {
    prisma: {
      user: { findUnique: findUserUnique, update: updateUser, findMany: findManyUsers },
      verificationToken: {
        findUnique: findTokenUnique,
        create: createToken,
        update: updateToken,
        updateMany: updateManyTokens,
      },
      follow: { deleteMany: deleteManyFollows },
      $transaction,
    } as unknown as import("@prisma/client").PrismaClient,
    mocks: {
      findUserUnique,
      updateUser,
      findManyUsers,
      findTokenUnique,
      createToken,
      updateToken,
      updateManyTokens,
      deleteManyFollows,
      deleteManyReviews,
      deleteManyReviewLikes,
      deleteManyReviewComments,
      deleteManyAttendances,
      $transaction,
    },
  };
}

// ---------------------------------------------------------------------------
// requestAccountDelete
// ---------------------------------------------------------------------------

describe("requestAccountDelete", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("happy: creates token, sends email, returns ok+emailAttempted", async () => {
    setup.mocks.findUserUnique.mockResolvedValueOnce({
      id: "u1",
      handle: "penn",
      email: "p@example.com",
      deletedAt: null,
      anonymizedAt: null,
    });
    setup.mocks.createToken.mockResolvedValueOnce({ token: "tk_fresh" });
    const sendEmail = vi.fn().mockResolvedValue({ sent: true, id: "msg" });

    const result = await requestAccountDelete(
      { userId: "u1" },
      {
        prisma: setup.prisma,
        sendAccountDeleteConfirmEmail: sendEmail,
        now: () => fixedNow,
      },
    );

    expect(result).toEqual({ ok: true, emailAttempted: true });
    expect(setup.mocks.updateManyTokens).toHaveBeenCalledWith({
      where: { userId: "u1", type: "account_delete", consumedAt: null },
      data: { consumedAt: fixedNow },
    });
    const createCall = setup.mocks.createToken.mock.calls[0]![0];
    expect(createCall.data.type).toBe("account_delete");
    expect(createCall.data.userId).toBe("u1");
    expect(createCall.data.token).toMatch(/^[0-9a-f]{64}$/);
    expect(
      createCall.data.expiresAt.getTime() - fixedNow.getTime(),
    ).toBe(60 * 60_000);
    expect(sendEmail).toHaveBeenCalledWith({
      to: "p@example.com",
      handle: "penn",
      token: "tk_fresh",
    });
  });

  it("returns already_pending when deletedAt is set", async () => {
    setup.mocks.findUserUnique.mockResolvedValueOnce({
      id: "u1",
      handle: "penn",
      email: "p@example.com",
      deletedAt: new Date("2026-06-01"),
      anonymizedAt: null,
    });
    const sendEmail = vi.fn();
    const result = await requestAccountDelete(
      { userId: "u1" },
      {
        prisma: setup.prisma,
        sendAccountDeleteConfirmEmail: sendEmail,
        now: () => fixedNow,
      },
    );
    expect(result).toEqual({ ok: false, reason: "already_pending" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(setup.mocks.createToken).not.toHaveBeenCalled();
  });

  it("returns anonymized when anonymizedAt is set", async () => {
    setup.mocks.findUserUnique.mockResolvedValueOnce({
      id: "u1",
      handle: "_deleted_cm123456",
      email: null,
      deletedAt: new Date("2026-05-01"),
      anonymizedAt: new Date("2026-05-31"),
    });
    const sendEmail = vi.fn();
    const result = await requestAccountDelete(
      { userId: "u1" },
      {
        prisma: setup.prisma,
        sendAccountDeleteConfirmEmail: sendEmail,
        now: () => fixedNow,
      },
    );
    expect(result).toEqual({ ok: false, reason: "anonymized" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("returns no_email for pre-Phase-1 users without an email on file", async () => {
    setup.mocks.findUserUnique.mockResolvedValueOnce({
      id: "u_old",
      handle: "earlybird",
      email: null,
      deletedAt: null,
      anonymizedAt: null,
    });
    const sendEmail = vi.fn();
    const result = await requestAccountDelete(
      { userId: "u_old" },
      {
        prisma: setup.prisma,
        sendAccountDeleteConfirmEmail: sendEmail,
        now: () => fixedNow,
      },
    );
    expect(result).toEqual({ ok: false, reason: "no_email" });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// confirmAccountDelete
// ---------------------------------------------------------------------------

describe("confirmAccountDelete", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("invalid_token when token not found", async () => {
    setup.mocks.findTokenUnique.mockResolvedValueOnce(null);
    const result = await confirmAccountDelete(
      { token: "ghost" },
      { prisma: setup.prisma, now: () => fixedNow },
    );
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
    expect(setup.mocks.$transaction).not.toHaveBeenCalled();
  });

  it("invalid_token when type is wrong (e.g., password_reset)", async () => {
    setup.mocks.findTokenUnique.mockResolvedValueOnce({
      id: "t1",
      userId: "u1",
      type: "password_reset",
      expiresAt: new Date(fixedNow.getTime() + 60_000),
      consumedAt: null,
      user: { id: "u1", anonymizedAt: null, deletedAt: null },
    });
    const result = await confirmAccountDelete(
      { token: "wrong" },
      { prisma: setup.prisma, now: () => fixedNow },
    );
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("expired when past expiresAt", async () => {
    setup.mocks.findTokenUnique.mockResolvedValueOnce({
      id: "t1",
      userId: "u1",
      type: "account_delete",
      expiresAt: new Date(fixedNow.getTime() - 60_000),
      consumedAt: null,
      user: { id: "u1", anonymizedAt: null, deletedAt: null },
    });
    const result = await confirmAccountDelete(
      { token: "stale" },
      { prisma: setup.prisma, now: () => fixedNow },
    );
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("consumed when already used", async () => {
    setup.mocks.findTokenUnique.mockResolvedValueOnce({
      id: "t1",
      userId: "u1",
      type: "account_delete",
      expiresAt: new Date(fixedNow.getTime() + 60_000),
      consumedAt: new Date(fixedNow.getTime() - 60_000),
      user: { id: "u1", anonymizedAt: null, deletedAt: null },
    });
    const result = await confirmAccountDelete(
      { token: "used" },
      { prisma: setup.prisma, now: () => fixedNow },
    );
    expect(result).toEqual({ ok: false, reason: "consumed" });
  });

  it("anonymized when user has already been anonymized", async () => {
    setup.mocks.findTokenUnique.mockResolvedValueOnce({
      id: "t1",
      userId: "u1",
      type: "account_delete",
      expiresAt: new Date(fixedNow.getTime() + 60_000),
      consumedAt: null,
      user: { id: "u1", anonymizedAt: new Date("2026-01-01"), deletedAt: new Date("2025-12-01") },
    });
    const result = await confirmAccountDelete(
      { token: "tk" },
      { prisma: setup.prisma, now: () => fixedNow },
    );
    expect(result).toEqual({ ok: false, reason: "anonymized" });
    expect(setup.mocks.$transaction).not.toHaveBeenCalled();
  });

  it("success: sets deletedAt, consumes token, returns scheduledFor=now+30d", async () => {
    setup.mocks.findTokenUnique.mockResolvedValueOnce({
      id: "t_id",
      userId: "u_id",
      type: "account_delete",
      expiresAt: new Date(fixedNow.getTime() + 60_000),
      consumedAt: null,
      user: { id: "u_id", anonymizedAt: null, deletedAt: null },
    });

    const result = await confirmAccountDelete(
      { token: "valid" },
      { prisma: setup.prisma, now: () => fixedNow },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deletionScheduledFor.getTime() - fixedNow.getTime()).toBe(
        GRACE_MS,
      );
    }
    expect(setup.mocks.$transaction).toHaveBeenCalledOnce();
    const userCall = setup.mocks.updateUser.mock.calls[0]![0];
    expect(userCall.where).toEqual({ id: "u_id" });
    expect(userCall.data).toEqual({ deletedAt: fixedNow });
    const tokenCall = setup.mocks.updateToken.mock.calls[0]![0];
    expect(tokenCall.where).toEqual({ id: "t_id" });
    expect(tokenCall.data).toEqual({ consumedAt: fixedNow });
  });

  it("when user already had deletedAt set, preserves original (does not restart grace clock)", async () => {
    const originalDeletedAt = new Date("2026-06-15T00:00:00.000Z");
    setup.mocks.findTokenUnique.mockResolvedValueOnce({
      id: "t_id",
      userId: "u_id",
      type: "account_delete",
      expiresAt: new Date(fixedNow.getTime() + 60_000),
      consumedAt: null,
      user: { id: "u_id", anonymizedAt: null, deletedAt: originalDeletedAt },
    });

    const result = await confirmAccountDelete(
      { token: "valid" },
      { prisma: setup.prisma, now: () => fixedNow },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deletionScheduledFor.getTime() - originalDeletedAt.getTime()).toBe(
        GRACE_MS,
      );
    }
    const userCall = setup.mocks.updateUser.mock.calls[0]![0];
    // No-op user update when deletedAt was already set
    expect(userCall.data).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// cancelAccountDelete
// ---------------------------------------------------------------------------

describe("cancelAccountDelete", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("clears deletedAt when in grace period", async () => {
    setup.mocks.findUserUnique.mockResolvedValueOnce({
      id: "u1",
      deletedAt: new Date("2026-06-15"),
      anonymizedAt: null,
    });

    const result = await cancelAccountDelete(
      { userId: "u1" },
      { prisma: setup.prisma },
    );

    expect(result).toEqual({ ok: true });
    expect(setup.mocks.updateUser).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { deletedAt: null },
    });
  });

  it("no_pending when deletedAt is null", async () => {
    setup.mocks.findUserUnique.mockResolvedValueOnce({
      id: "u1",
      deletedAt: null,
      anonymizedAt: null,
    });
    const result = await cancelAccountDelete(
      { userId: "u1" },
      { prisma: setup.prisma },
    );
    expect(result).toEqual({ ok: false, reason: "no_pending" });
    expect(setup.mocks.updateUser).not.toHaveBeenCalled();
  });

  it("anonymized when already anonymized (cannot un-tombstone)", async () => {
    setup.mocks.findUserUnique.mockResolvedValueOnce({
      id: "u1",
      deletedAt: new Date("2026-05-01"),
      anonymizedAt: new Date("2026-06-01"),
    });
    const result = await cancelAccountDelete(
      { userId: "u1" },
      { prisma: setup.prisma },
    );
    expect(result).toEqual({ ok: false, reason: "anonymized" });
    expect(setup.mocks.updateUser).not.toHaveBeenCalled();
  });

  it("anonymized when user not found (defensive)", async () => {
    setup.mocks.findUserUnique.mockResolvedValueOnce(null);
    const result = await cancelAccountDelete(
      { userId: "ghost" },
      { prisma: setup.prisma },
    );
    expect(result).toEqual({ ok: false, reason: "anonymized" });
  });
});

// ---------------------------------------------------------------------------
// cleanupAccountDeletions
// ---------------------------------------------------------------------------

describe("cleanupAccountDeletions", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("anonymizes users past grace, strips all PII, deletes follows, counts results", async () => {
    setup.mocks.findManyUsers.mockResolvedValueOnce([
      { id: "cmuserid1abcdef12" },
      { id: "cmuserid2abcdef34" },
    ]);
    setup.mocks.deleteManyFollows
      .mockResolvedValueOnce({ count: 3 }) // as follower of user 1
      .mockResolvedValueOnce({ count: 2 }) // as following of user 1
      .mockResolvedValueOnce({ count: 1 }) // as follower of user 2
      .mockResolvedValueOnce({ count: 0 }); // as following of user 2

    const result = await cleanupAccountDeletions({
      prisma: setup.prisma,
      now: () => fixedNow,
    });

    expect(result).toEqual({ anonymized: 2, followsDeleted: 6 });

    // Each user got an update with all PII nulled and anonymizedAt set
    const updates = setup.mocks.updateUser.mock.calls.map((c: any) => c[0]);
    expect(updates.length).toBe(2);
    for (const call of updates) {
      expect(call.data.email).toBe(null);
      expect(call.data.emailVerifiedAt).toBe(null);
      expect(call.data.passwordHash).toBe(null);
      expect(call.data.name).toBe(null);
      expect(call.data.avatarUrl).toBe(null);
      expect(call.data.handle).toMatch(/^_deleted_cmuserid[0-9]abcdef[0-9]{2}$/);
      expect(call.data.anonymizedAt).toBe(fixedNow);
    }

    // findMany was scoped to "deletedAt < cutoff (now - 30d) AND anonymizedAt IS NULL"
    const findArg = setup.mocks.findManyUsers.mock.calls[0]![0];
    expect(findArg.where.anonymizedAt).toBe(null);
    const cutoff = new Date(fixedNow.getTime() - GRACE_MS);
    expect(findArg.where.deletedAt.lt).toEqual(cutoff);
    expect(findArg.where.deletedAt.not).toBe(null);
  });

  it("returns zeros and does nothing when no users are due", async () => {
    setup.mocks.findManyUsers.mockResolvedValueOnce([]);
    const result = await cleanupAccountDeletions({
      prisma: setup.prisma,
      now: () => fixedNow,
    });
    expect(result).toEqual({ anonymized: 0, followsDeleted: 0 });
    expect(setup.mocks.updateUser).not.toHaveBeenCalled();
    expect(setup.mocks.deleteManyFollows).not.toHaveBeenCalled();
  });

  /**
   * The concert archive is the product. Anonymization severs the identity
   * but must never remove the contributions — a reviewer deleting their
   * account cannot silently delete a show's review history with them.
   */
  it("never deletes reviews, comments, likes or attendance", async () => {
    setup.mocks.findManyUsers.mockResolvedValueOnce([
      { id: "cmuserid1abcdef12" },
    ]);

    await cleanupAccountDeletions({
      prisma: setup.prisma,
      now: () => fixedNow,
    });

    expect(setup.mocks.deleteManyReviews).not.toHaveBeenCalled();
    expect(setup.mocks.deleteManyReviewLikes).not.toHaveBeenCalled();
    expect(setup.mocks.deleteManyReviewComments).not.toHaveBeenCalled();
    expect(setup.mocks.deleteManyAttendances).not.toHaveBeenCalled();

    // The User row survives too — anonymized in place, never deleted, so
    // the foreign keys those archive rows depend on stay intact.
    const updates = setup.mocks.updateUser.mock.calls.map((c: any) => c[0]);
    expect(updates.length).toBe(1);
    expect(updates[0].data.anonymizedAt).toBe(fixedNow);
  });

  /**
   * The job runs nightly and retries on failure, so re-processing an
   * already-anonymized user must be impossible. anonymizedAt is the
   * marker: set inside the same transaction, and excluded by the query.
   */
  it("is idempotent — an already-anonymized user is never picked up twice", async () => {
    // Pass 1: one user due.
    setup.mocks.findManyUsers.mockResolvedValueOnce([
      { id: "cmuserid1abcdef12" },
    ]);
    const first = await cleanupAccountDeletions({
      prisma: setup.prisma,
      now: () => fixedNow,
    });
    expect(first.anonymized).toBe(1);

    // The marker is written in the same transaction as the PII strip, so
    // it cannot be set without the work having happened.
    expect(setup.mocks.updateUser.mock.calls[0]![0].data.anonymizedAt).toBe(
      fixedNow,
    );

    // Pass 2: the query excludes anonymizedAt != null, so the same user is
    // no longer returned and no further writes occur.
    setup.mocks.updateUser.mockClear();
    setup.mocks.deleteManyFollows.mockClear();
    setup.mocks.findManyUsers.mockResolvedValueOnce([]);

    const second = await cleanupAccountDeletions({
      prisma: setup.prisma,
      now: () => fixedNow,
    });
    expect(second).toEqual({ anonymized: 0, followsDeleted: 0 });
    expect(setup.mocks.updateUser).not.toHaveBeenCalled();
    expect(setup.mocks.deleteManyFollows).not.toHaveBeenCalled();

    for (const call of setup.mocks.findManyUsers.mock.calls) {
      expect(call[0].where.anonymizedAt).toBe(null);
    }
  });

  /**
   * Anonymizing a day early would breach the grace period we tell users
   * they have to change their mind.
   */
  it("does not touch a user still inside the grace period", async () => {
    // The boundary is enforced by the query itself (deletedAt < now-30d),
    // so assert the cutoff is exact rather than off by a day either way.
    setup.mocks.findManyUsers.mockResolvedValueOnce([]);
    await cleanupAccountDeletions({
      prisma: setup.prisma,
      now: () => fixedNow,
    });
    const where = setup.mocks.findManyUsers.mock.calls[0]![0].where;
    expect(where.deletedAt.lt).toEqual(new Date(fixedNow.getTime() - GRACE_MS));
    expect(setup.mocks.updateUser).not.toHaveBeenCalled();
  });
});
