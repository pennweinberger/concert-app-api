import { describe, it, expect } from "vitest";
import {
  generateTokenString,
  tokenExpiresAt,
  isTokenExpired,
  checkToken,
} from "./tokens.js";

describe("generateTokenString", () => {
  it("returns 64 hex chars", () => {
    const t = generateTokenString();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns a different value on each call", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(generateTokenString());
    expect(seen.size).toBe(50);
  });
});

describe("tokenExpiresAt / isTokenExpired", () => {
  it("email_verify token expires 24h from now", () => {
    const now = new Date("2026-06-14T10:00:00.000Z");
    const exp = tokenExpiresAt("email_verify", now);
    expect(exp.getTime() - now.getTime()).toBe(24 * 60 * 60_000);
  });

  it("password_reset token expires 1h from now", () => {
    const now = new Date("2026-06-14T10:00:00.000Z");
    const exp = tokenExpiresAt("password_reset", now);
    expect(exp.getTime() - now.getTime()).toBe(60 * 60_000);
  });

  it("isTokenExpired returns true when expiresAt is past", () => {
    const now = new Date("2026-06-14T10:00:00.000Z");
    const past = new Date("2026-06-14T09:59:59.000Z");
    expect(isTokenExpired(past, now)).toBe(true);
  });

  it("isTokenExpired returns false at the exact expiry boundary", () => {
    const now = new Date("2026-06-14T10:00:00.000Z");
    expect(isTokenExpired(now, now)).toBe(false);
  });
});

describe("checkToken", () => {
  const now = new Date("2026-06-14T10:00:00.000Z");

  it("ok when record is fresh and types match", () => {
    const result = checkToken({
      record: {
        type: "email_verify",
        expiresAt: new Date("2026-06-14T11:00:00.000Z"),
        consumedAt: null,
      },
      expectedType: "email_verify",
      now,
    });
    expect(result).toEqual({ ok: true });
  });

  it("not_found when record is null", () => {
    const result = checkToken({
      record: null,
      expectedType: "email_verify",
      now,
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("wrong_type when stored type does not match expected", () => {
    const result = checkToken({
      record: {
        type: "password_reset",
        expiresAt: new Date("2026-06-14T11:00:00.000Z"),
        consumedAt: null,
      },
      expectedType: "email_verify",
      now,
    });
    expect(result).toEqual({ ok: false, reason: "wrong_type" });
  });

  it("consumed when consumedAt is set, regardless of expiry", () => {
    const result = checkToken({
      record: {
        type: "email_verify",
        expiresAt: new Date("2026-06-14T11:00:00.000Z"),
        consumedAt: new Date("2026-06-14T09:30:00.000Z"),
      },
      expectedType: "email_verify",
      now,
    });
    expect(result).toEqual({ ok: false, reason: "consumed" });
  });

  it("expired when expiresAt is in the past and not consumed", () => {
    const result = checkToken({
      record: {
        type: "email_verify",
        expiresAt: new Date("2026-06-14T09:00:00.000Z"),
        consumedAt: null,
      },
      expectedType: "email_verify",
      now,
    });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });
});
