import { describe, it, expect, vi, beforeEach } from "vitest";
import { forgotPassword, resetPassword } from "./passwordReset.js";

const fixedNow = new Date("2026-06-19T12:00:00.000Z");

function makeMockPrisma() {
  const findUserUnique = vi.fn();
  const updateUser = vi.fn().mockResolvedValue({});
  const findTokenUnique = vi.fn();
  const createToken = vi.fn();
  const updateToken = vi.fn().mockResolvedValue({});
  const updateManyTokens = vi.fn().mockResolvedValue({ count: 0 });

  const $transaction = vi.fn().mockImplementation(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    throw new Error("unexpected $transaction arg shape");
  });

  return {
    prisma: {
      user: { findUnique: findUserUnique, update: updateUser },
      verificationToken: {
        findUnique: findTokenUnique,
        create: createToken,
        update: updateToken,
        updateMany: updateManyTokens,
      },
      $transaction,
    } as unknown as import("@prisma/client").PrismaClient,
    mocks: {
      findUserUnique,
      updateUser,
      findTokenUnique,
      createToken,
      updateToken,
      updateManyTokens,
      $transaction,
    },
  };
}

// ---------------------------------------------------------------------------
// forgotPassword
// ---------------------------------------------------------------------------

describe("forgotPassword — anti-enumeration", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("when no user has the email: emailAttempted=false, no DB writes, no email sent", async () => {
    setup.mocks.findUserUnique.mockResolvedValueOnce(null);
    const sendEmail = vi.fn();

    const result = await forgotPassword(
      { email: "ghost@example.com" },
      {
        prisma: setup.prisma,
        sendPasswordResetEmail: sendEmail,
        now: () => fixedNow,
      },
    );

    expect(result).toEqual({ emailAttempted: false });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(setup.mocks.createToken).not.toHaveBeenCalled();
    expect(setup.mocks.updateManyTokens).not.toHaveBeenCalled();
  });

  it("when user exists: invalidates prior tokens, creates new token, sends email", async () => {
    setup.mocks.findUserUnique.mockResolvedValueOnce({
      id: "u_real",
      handle: "penn",
      email: "real@example.com",
    });
    setup.mocks.createToken.mockResolvedValueOnce({ token: "fresh_tok_64chars" });
    const sendEmail = vi
      .fn()
      .mockResolvedValue({ sent: true, id: "msg_1" });

    const result = await forgotPassword(
      { email: "real@example.com" },
      {
        prisma: setup.prisma,
        sendPasswordResetEmail: sendEmail,
        now: () => fixedNow,
      },
    );

    expect(result).toEqual({ emailAttempted: true });

    // Prior un-consumed password_reset tokens get marked consumed at now
    expect(setup.mocks.updateManyTokens).toHaveBeenCalledWith({
      where: { userId: "u_real", type: "password_reset", consumedAt: null },
      data: { consumedAt: fixedNow },
    });

    // New token is password_reset type, 1-hour TTL
    const createCall = setup.mocks.createToken.mock.calls[0]![0];
    expect(createCall.data.userId).toBe("u_real");
    expect(createCall.data.type).toBe("password_reset");
    expect(createCall.data.token).toMatch(/^[0-9a-f]{64}$/);
    expect(
      createCall.data.expiresAt.getTime() - fixedNow.getTime(),
    ).toBe(60 * 60_000);

    // Email sent with the newly-minted token
    expect(sendEmail).toHaveBeenCalledWith({
      to: "real@example.com",
      handle: "penn",
      token: "fresh_tok_64chars",
    });
  });
});

// ---------------------------------------------------------------------------
// resetPassword
// ---------------------------------------------------------------------------

describe("resetPassword", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("weak_password when shorter than 8 chars (no DB call)", async () => {
    const result = await resetPassword(
      { token: "anytoken", newPassword: "short" },
      { prisma: setup.prisma, now: () => fixedNow },
    );
    expect(result).toEqual({ ok: false, reason: "weak_password" });
    expect(setup.mocks.findTokenUnique).not.toHaveBeenCalled();
  });

  it("weak_password when longer than 128 chars", async () => {
    const result = await resetPassword(
      { token: "anytoken", newPassword: "x".repeat(129) },
      { prisma: setup.prisma, now: () => fixedNow },
    );
    expect(result).toEqual({ ok: false, reason: "weak_password" });
    expect(setup.mocks.findTokenUnique).not.toHaveBeenCalled();
  });

  it("accepts exactly 8 chars and exactly 128 chars (boundary)", async () => {
    // We expect this to PROCEED past the password check; tests below
    // construct token records so the reset succeeds.
    for (const len of [8, 128]) {
      setup = makeMockPrisma();
      setup.mocks.findTokenUnique.mockResolvedValueOnce({
        id: "t1",
        userId: "u1",
        type: "password_reset",
        expiresAt: new Date(fixedNow.getTime() + 60_000),
        consumedAt: null,
      });
      const result = await resetPassword(
        { token: "valid", newPassword: "a".repeat(len) },
        { prisma: setup.prisma, now: () => fixedNow },
      );
      expect(result).toEqual({ ok: true });
    }
  });

  it("invalid_token when token not found", async () => {
    setup.mocks.findTokenUnique.mockResolvedValueOnce(null);
    const result = await resetPassword(
      { token: "doesnotexist", newPassword: "a_good_password" },
      { prisma: setup.prisma, now: () => fixedNow },
    );
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
    expect(setup.mocks.$transaction).not.toHaveBeenCalled();
  });

  it("invalid_token when token is for the wrong flow (email_verify)", async () => {
    setup.mocks.findTokenUnique.mockResolvedValueOnce({
      id: "t1",
      userId: "u1",
      type: "email_verify", // wrong flow
      expiresAt: new Date(fixedNow.getTime() + 60_000),
      consumedAt: null,
    });
    const result = await resetPassword(
      { token: "wrongflow", newPassword: "a_good_password" },
      { prisma: setup.prisma, now: () => fixedNow },
    );
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
    expect(setup.mocks.$transaction).not.toHaveBeenCalled();
  });

  it("expired when expiresAt is in the past", async () => {
    setup.mocks.findTokenUnique.mockResolvedValueOnce({
      id: "t1",
      userId: "u1",
      type: "password_reset",
      expiresAt: new Date(fixedNow.getTime() - 60_000),
      consumedAt: null,
    });
    const result = await resetPassword(
      { token: "stale", newPassword: "a_good_password" },
      { prisma: setup.prisma, now: () => fixedNow },
    );
    expect(result).toEqual({ ok: false, reason: "expired" });
    expect(setup.mocks.$transaction).not.toHaveBeenCalled();
  });

  it("consumed when token already used", async () => {
    setup.mocks.findTokenUnique.mockResolvedValueOnce({
      id: "t1",
      userId: "u1",
      type: "password_reset",
      expiresAt: new Date(fixedNow.getTime() + 60_000),
      consumedAt: new Date(fixedNow.getTime() - 30_000),
    });
    const result = await resetPassword(
      { token: "used", newPassword: "a_good_password" },
      { prisma: setup.prisma, now: () => fixedNow },
    );
    expect(result).toEqual({ ok: false, reason: "consumed" });
    expect(setup.mocks.$transaction).not.toHaveBeenCalled();
  });

  it("success: hashes new password, updates user, marks token consumed in a transaction", async () => {
    setup.mocks.findTokenUnique.mockResolvedValueOnce({
      id: "tok_id_123",
      userId: "user_id_xyz",
      type: "password_reset",
      expiresAt: new Date(fixedNow.getTime() + 60_000),
      consumedAt: null,
    });

    const result = await resetPassword(
      { token: "valid_token", newPassword: "a_brand_new_password" },
      { prisma: setup.prisma, now: () => fixedNow },
    );

    expect(result).toEqual({ ok: true });
    expect(setup.mocks.$transaction).toHaveBeenCalledOnce();

    // User update: bcrypt hash, not plaintext
    const userCall = setup.mocks.updateUser.mock.calls[0]![0];
    expect(userCall.where).toEqual({ id: "user_id_xyz" });
    expect(userCall.data.passwordHash).toMatch(/^\$2[ayb]\$/);
    expect(userCall.data.passwordHash).not.toBe("a_brand_new_password");

    // Token marked consumed at now
    const tokenCall = setup.mocks.updateToken.mock.calls[0]![0];
    expect(tokenCall.where).toEqual({ id: "tok_id_123" });
    expect(tokenCall.data.consumedAt).toBe(fixedNow);
  });
});
