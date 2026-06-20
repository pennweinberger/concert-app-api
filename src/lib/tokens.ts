// Verification tokens — pure helpers for token lifecycle. The Prisma
// model `VerificationToken` is the source of truth for state; these
// helpers only produce the values you stuff into it.

import { randomBytes } from "node:crypto";

export type VerificationTokenType =
  | "email_verify"
  | "password_reset"
  | "account_delete";

// TTLs by token type. Email verify is intentionally generous (most
// users won't click the link immediately). Password reset is tight
// because the attack window matters more. Account delete is also
// tight — destructive action, short window is appropriate.
const TTL_MS: Record<VerificationTokenType, number> = {
  email_verify: 24 * 60 * 60_000,
  password_reset: 60 * 60_000,
  account_delete: 60 * 60_000,
};

// 64 hex chars (256 bits of entropy). Plenty against brute force, and
// short enough to fit cleanly in a URL.
export function generateTokenString(): string {
  return randomBytes(32).toString("hex");
}

export function tokenExpiresAt(
  type: VerificationTokenType,
  now: Date
): Date {
  return new Date(now.getTime() + TTL_MS[type]);
}

export function isTokenExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() < now.getTime();
}

export type TokenValidity =
  | { ok: true }
  | { ok: false; reason: "not_found" | "expired" | "consumed" | "wrong_type" };

export function checkToken(opts: {
  record:
    | {
        type: string;
        expiresAt: Date;
        consumedAt: Date | null;
      }
    | null;
  expectedType: VerificationTokenType;
  now: Date;
}): TokenValidity {
  const { record, expectedType, now } = opts;
  if (!record) return { ok: false, reason: "not_found" };
  if (record.type !== expectedType) return { ok: false, reason: "wrong_type" };
  if (record.consumedAt) return { ok: false, reason: "consumed" };
  if (isTokenExpired(record.expiresAt, now))
    return { ok: false, reason: "expired" };
  return { ok: true };
}
