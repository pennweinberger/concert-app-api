import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  inspectHandleCase,
  describeConnection,
  fingerprint,
  CITEXT_RESOLVABLE_SQL,
  SEARCH_PATH_SQL,
  HANDLE_COLUMN_TYPE_SQL,
} from "./handleCase.js";

/** A fake SqlRunner that answers each known query from a table. */
function runnerFor(answers: Record<string, unknown[]>, opts: { throwOn?: string[] } = {}) {
  const seen: string[] = [];
  const run = async (sql: string) => {
    seen.push(sql);
    if (opts.throwOn?.includes(sql)) throw new Error("boom: " + sql.slice(0, 20));
    return answers[sql] ?? [];
  };
  return { run, seen };
}

const HEALTHY = {
  [CITEXT_RESOLVABLE_SQL]: [{ t: "citext" }],
  [SEARCH_PATH_SQL]: [{ search_path: '"$user", public, extensions' }],
  [HANDLE_COLUMN_TYPE_SQL]: [{ t: "citext" }],
};

const SILENTLY_BROKEN = {
  // What Postgres returns when `extensions` is not in the search_path: the
  // column is still citext, but Prisma cannot resolve the type, so every
  // comparison degrades to case-sensitive text equality.
  [CITEXT_RESOLVABLE_SQL]: [{ t: null }],
  [SEARCH_PATH_SQL]: [{ search_path: '"public"' }],
  [HANDLE_COLUMN_TYPE_SQL]: [{ t: "citext" }],
};

describe("inspectHandleCase", () => {
  it("reports healthy when Prisma can resolve citext", async () => {
    const { run } = runnerFor(HEALTHY);
    const r = await inspectHandleCase(run);
    expect(r.citextResolvable).toBe(true);
    expect(r.searchPath).toBe('"$user", public, extensions');
    expect(r.handleColumnType).toBe("citext");
    expect(r.error).toBeUndefined();
  });

  // The case this guard exists for. The column type alone looks fine, which
  // is exactly why the column type alone is not the check.
  it("reports UNHEALTHY when to_regtype('citext') is null, even though the column is still citext", async () => {
    const { run } = runnerFor(SILENTLY_BROKEN);
    const r = await inspectHandleCase(run);
    expect(r.citextResolvable).toBe(false);
    expect(r.handleColumnType).toBe("citext");
    expect(r.searchPath).toBe('"public"');
  });

  it("asks the citext question through the runner it was given, not a raw driver", async () => {
    const { run, seen } = runnerFor(HEALTHY);
    await inspectHandleCase(run);
    expect(seen).toContain(CITEXT_RESOLVABLE_SQL);
  });

  it("still returns the verdict when the diagnostic queries fail", async () => {
    const { run } = runnerFor(HEALTHY, {
      throwOn: [SEARCH_PATH_SQL, HANDLE_COLUMN_TYPE_SQL],
    });
    const r = await inspectHandleCase(run);
    expect(r.citextResolvable).toBe(true);
    expect(r.searchPath).toBeNull();
    expect(r.handleColumnType).toBeNull();
    expect(r.error).toBeUndefined();
  });

  it("never throws, and flags an inspection failure so callers do not cache it", async () => {
    const { run } = runnerFor(HEALTHY, { throwOn: [CITEXT_RESOLVABLE_SQL] });
    const r = await inspectHandleCase(run);
    expect(r.citextResolvable).toBe(false);
    expect(r.error).toMatch(/boom/);
  });

  it("treats a missing column or empty result as unresolvable rather than crashing", async () => {
    const { run } = runnerFor({ [CITEXT_RESOLVABLE_SQL]: [] });
    const r = await inspectHandleCase(run);
    expect(r.citextResolvable).toBe(false);
  });
});

describe("describeConnection", () => {
  const SECRET =
    "postgresql://postgres.abcdefghijklmnop:s3cr3t-p4ssw0rd@aws-0-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true";

  it("never returns any part of the credential", () => {
    const d = describeConnection(SECRET);
    const serialized = JSON.stringify(d);
    expect(serialized).not.toContain("s3cr3t-p4ssw0rd");
    expect(serialized).not.toContain("abcdefghijklmnop");
    expect(serialized).not.toContain("pooler.supabase.com");
  });

  it("fingerprints the host so two environments can be compared for equality", () => {
    const a = describeConnection(SECRET);
    const b = describeConnection(SECRET);
    const other = describeConnection(
      "postgresql://u:p@db.zzzzzzzzzzzz.supabase.co:5432/postgres",
    );
    expect(a.hostFingerprint).toBe(b.hostFingerprint);
    expect(a.hostFingerprint).not.toBe(other.hostFingerprint);
    expect(a.hostFingerprint).toMatch(/^[0-9a-f]{12}$/);
  });

  it("surfaces the port, database and pgbouncer flag", () => {
    const d = describeConnection(SECRET);
    expect(d.port).toBe("6543");
    expect(d.database).toBe("postgres");
    expect(d.hasPgbouncerParam).toBe(true);
  });

  // The single setting that silently disables case-insensitive handles.
  it("detects a pinned ?schema= parameter", () => {
    const pinned = describeConnection(
      "postgresql://u:p@host.example.com:5432/postgres?schema=public",
    );
    expect(pinned.hasSchemaParam).toBe(true);
    expect(pinned.schemaParam).toBe("public");

    const unpinned = describeConnection(
      "postgresql://u:p@host.example.com:5432/postgres",
    );
    expect(unpinned.hasSchemaParam).toBe(false);
    expect(unpinned.schemaParam).toBeNull();
  });

  it("handles a missing or unparseable URL without throwing", () => {
    expect(describeConnection(undefined).hostFingerprint).toBeNull();
    expect(describeConnection("not a url").hostFingerprint).toBeNull();
  });
});

// Regression protection for the two pieces of configuration that silently
// switch case-insensitive handles off. Neither has a runtime code path that
// would fail visibly if it were removed, so assert them here.
describe("case-insensitive handle configuration", () => {
  const root = process.cwd();
  const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
  const handleLine = schema
    .split("\n")
    .find((l) => /^\s*handle\s+String/.test(l));

  // If this test fails, differently-cased logins break under concurrency
  // ONLY — verified against real Postgres with real Prisma 6.19.2: with the
  // column citext but the annotation absent, three concurrent findUnique
  // calls batch into `WHERE handle IN (...)` and all three return nothing.
  // Single-request testing would not catch it.
  it("keeps @db.Citext on User.handle", () => {
    expect(handleLine).toBeDefined();
    expect(handleLine).toContain("@db.Citext");
    expect(handleLine).toContain("@unique");
  });

  it("does not lowercase handles anywhere in the schema", () => {
    // A `handleLower` mirror column would mean the DB is no longer the single
    // source of truth for case-insensitivity, and would desync on the
    // anonymization path in accountLifecycle.ts.
    expect(schema).not.toContain("handleLower");
  });

  const migrationDir = join(
    root,
    "prisma/migrations/20260930010000_handle_citext",
  );

  it("ships the migration that makes the column citext", () => {
    const sql = readFileSync(join(migrationDir, "migration.sql"), "utf8");
    expect(sql).toContain("CREATE EXTENSION IF NOT EXISTS citext");
    // Supabase's conventional schema, verified to resolve on Preview.
    expect(sql).toContain("WITH SCHEMA extensions");
    // Fully qualified so the DDL cannot depend on the migration connection's
    // search_path.
    expect(sql).toContain(
      'ALTER TABLE "User" ALTER COLUMN "handle" TYPE extensions.citext',
    );
  });

  it("never rewrites or lowercases existing handles", () => {
    const sql = readFileSync(join(migrationDir, "migration.sql"), "utf8");
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    expect(sql).not.toMatch(/\blower\s*\(/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
  });
});

describe("fingerprint", () => {
  it("is stable, short and one-way", () => {
    expect(fingerprint("hello")).toBe(fingerprint("hello"));
    expect(fingerprint("hello")).toHaveLength(12);
    expect(fingerprint("hello")).not.toContain("hello");
    expect(fingerprint("hello")).not.toBe(fingerprint("hellp"));
  });
});
