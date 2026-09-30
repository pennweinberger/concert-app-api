import { describe, it, expect } from "vitest";
import { normalizeHandle } from "./handles.js";

describe("normalizeHandle", () => {
  it("accepts a handle with or without a leading @", () => {
    expect(normalizeHandle("testuser")).toBe("testuser");
    expect(normalizeHandle("@testuser")).toBe("testuser");
  });

  it("tolerates surrounding whitespace, including around the @", () => {
    expect(normalizeHandle("  testuser  ")).toBe("testuser");
    expect(normalizeHandle("\ttestuser\n")).toBe("testuser");
    expect(normalizeHandle("  @testuser  ")).toBe("testuser");
  });

  // The whole point of pushing case-insensitivity into the database: the
  // stored value keeps the capitalization the user chose, so profiles and
  // display names are not flattened to lowercase.
  it("PRESERVES capitalization rather than folding case", () => {
    expect(normalizeHandle("TestUser")).toBe("TestUser");
    expect(normalizeHandle("TESTUSER")).toBe("TESTUSER");
    expect(normalizeHandle("@TestUser")).toBe("TestUser");
    expect(normalizeHandle("  @TESTUSER  ")).toBe("TESTUSER");
  });

  it("treats every casing as a valid handle so the database can match them", () => {
    for (const raw of ["penn", "Penn", "PENN", "pEnN", "@Penn", "  @PENN "]) {
      expect(normalizeHandle(raw)).not.toBeNull();
    }
  });

  it("keeps underscores, which are ordinary handle characters", () => {
    expect(normalizeHandle("atd_smoke")).toBe("atd_smoke");
    expect(normalizeHandle("@ATD_SMOKE")).toBe("ATD_SMOKE");
  });

  it("reserves leading underscores for system tombstones", () => {
    expect(normalizeHandle("_deleted_abc123")).toBeNull();
    expect(normalizeHandle("@_deleted_abc123")).toBeNull();
    expect(normalizeHandle("_penn")).toBeNull();
  });

  it("rejects anything outside the character set or length limits", () => {
    expect(normalizeHandle("ab")).toBeNull();
    expect(normalizeHandle("a".repeat(21))).toBeNull();
    expect(normalizeHandle("has space")).toBeNull();
    expect(normalizeHandle("has-dash")).toBeNull();
    expect(normalizeHandle("has.dot")).toBeNull();
    // Only a LEADING @ is stripped.
    expect(normalizeHandle("te@stuser")).toBeNull();
    expect(normalizeHandle("@@testuser")).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(normalizeHandle(undefined)).toBeNull();
    expect(normalizeHandle(null)).toBeNull();
    expect(normalizeHandle(42)).toBeNull();
    expect(normalizeHandle({ handle: "penn" })).toBeNull();
  });

  it("does not let SQL wildcards in, so no lookup can become a pattern match", () => {
    // citext compares with `=`, but this also rules out the ILIKE hazard that
    // Prisma's mode:"insensitive" would have introduced for `_` and `%`.
    expect(normalizeHandle("a%b")).toBeNull();
    expect(normalizeHandle("50%off")).toBeNull();
  });
});
