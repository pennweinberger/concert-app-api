// Password reset — pure handler functions with deps injected so they
// can be unit-tested against a mocked Prisma client and a mocked email
// sender. The HTTP routes in server.ts just delegate here.
//
// Design priorities:
// - Anti-enumeration on the /forgot-password path: the function reports
//   whether email send was attempted, but the route layer ALWAYS
//   responds 200 with the same body regardless. Do not leak which
//   emails belong to real accounts.
// - Idempotency on /reset-password: a token can only be used once
//   (checkToken catches reuse) and the route layer translates each
//   discriminated failure case into the right HTTP status.

import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generateTokenString, tokenExpiresAt, checkToken } from "./tokens.js";
import type { EmailSendResult } from "./email.js";

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

// ---------------------------------------------------------------------------
// forgotPassword
// ---------------------------------------------------------------------------

export type ForgotPasswordDeps = {
  prisma: PrismaClient;
  sendPasswordResetEmail: (opts: {
    to: string;
    handle: string;
    token: string;
  }) => Promise<EmailSendResult>;
  now: () => Date;
};

export type ForgotPasswordResult = {
  emailAttempted: boolean;
};

export async function forgotPassword(
  input: { email: string },
  deps: ForgotPasswordDeps,
): Promise<ForgotPasswordResult> {
  const user = await deps.prisma.user.findUnique({
    where: { email: input.email },
  });
  if (!user) {
    return { emailAttempted: false };
  }

  const now = deps.now();

  // Invalidate any prior un-consumed reset tokens so old links stop
  // working. Same pattern as resend-verification.
  await deps.prisma.verificationToken.updateMany({
    where: {
      userId: user.id,
      type: "password_reset",
      consumedAt: null,
    },
    data: { consumedAt: now },
  });

  const created = await deps.prisma.verificationToken.create({
    data: {
      userId: user.id,
      type: "password_reset",
      token: generateTokenString(),
      expiresAt: tokenExpiresAt("password_reset", now),
    },
  });

  await deps.sendPasswordResetEmail({
    to: input.email,
    handle: user.handle,
    token: created.token,
  });

  return { emailAttempted: true };
}

// ---------------------------------------------------------------------------
// resetPassword
// ---------------------------------------------------------------------------

export type ResetPasswordDeps = {
  prisma: PrismaClient;
  now: () => Date;
};

export type ResetPasswordResult =
  | { ok: true }
  | {
      ok: false;
      reason: "weak_password" | "invalid_token" | "expired" | "consumed";
    };

export async function resetPassword(
  input: { token: string; newPassword: string },
  deps: ResetPasswordDeps,
): Promise<ResetPasswordResult> {
  if (
    typeof input.newPassword !== "string" ||
    input.newPassword.length < MIN_PASSWORD_LENGTH ||
    input.newPassword.length > MAX_PASSWORD_LENGTH
  ) {
    return { ok: false, reason: "weak_password" };
  }

  const record = await deps.prisma.verificationToken.findUnique({
    where: { token: input.token },
  });

  const validity = checkToken({
    record: record
      ? {
          type: record.type,
          expiresAt: record.expiresAt,
          consumedAt: record.consumedAt,
        }
      : null,
    expectedType: "password_reset",
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

  if (!record) {
    return { ok: false, reason: "invalid_token" };
  }

  const passwordHash = await bcrypt.hash(input.newPassword, 10);
  const now = deps.now();

  await deps.prisma.$transaction([
    deps.prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    }),
    deps.prisma.verificationToken.update({
      where: { id: record.id },
      data: { consumedAt: now },
    }),
  ]);

  return { ok: true };
}
