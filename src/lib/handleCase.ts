// Case-insensitive handles: the runtime assertion that they are actually on.
//
// Handles are case-insensitive because User.handle is Postgres `citext`, so
// the existing User_handle_key unique index and every
// findUnique({ where: { handle } }) compare without regard to case. No query
// in the codebase changes — which is exactly why this needs a guard.
//
// The load-bearing and non-obvious part: Prisma must be able to resolve the
// `citext` type by its UNQUALIFIED name on its own connection. citext lives
// in Supabase's `extensions` schema, which is present in the default
// search_path. But Prisma pins search_path to a single schema whenever its
// connection string carries `?schema=`. If that ever happens, `citext` stops
// resolving, every handle comparison silently degrades to case-SENSITIVE
// text equality, and nothing announces it: the SQL is byte-identical, no
// error is raised, no log line appears, and exact-case logins keep working,
// so the system looks healthy while `PENN` can no longer log in as `penn`.
//
// `to_regtype('citext')` returning NULL on Prisma's own connection is an
// exact proxy for that failure. Verified against real Postgres with real
// Prisma 6.19.2: NULL and a missed differently-cased lookup occur together,
// and non-NULL and a successful one occur together.
//
// It must be asked THROUGH PRISMA. node-postgres ignores the `schema`
// parameter entirely, so a raw driver reports citext as resolvable even
// while Prisma cannot see it — a raw-driver check would be reassuring and
// wrong.

import { createHash } from "node:crypto";

/**
 * Runs a parameterless SQL string and returns the rows. In production this
 * is `(sql) => prisma.$queryRawUnsafe(sql)`; tests pass a fake.
 */
export type SqlRunner = (sql: string) => Promise<unknown[]>;

/** Does Prisma resolve `citext` on its own connection? NULL means no. */
export const CITEXT_RESOLVABLE_SQL = "select to_regtype('citext')::text as t";

/** Prisma's effective search_path, which is what decides the above. */
export const SEARCH_PATH_SQL = "show search_path";

/** The actual column type, independent of what schema.prisma claims. */
export const HANDLE_COLUMN_TYPE_SQL =
  'select format_type(atttypid, atttypmod) as t from pg_attribute' +
  ' where attrelid = \'"User"\'::regclass and attname = \'handle\'';

/** Which schema the extension was installed into, if at all. */
export const CITEXT_SCHEMA_SQL =
  "select n.nspname as s from pg_extension e" +
  " join pg_namespace n on n.oid = e.extnamespace where e.extname = 'citext'";

export type HandleCaseReport = {
  /** The one that matters: false means case-insensitivity is OFF. */
  citextResolvable: boolean;
  searchPath: string | null;
  handleColumnType: string | null;
  /** Set when the inspection itself failed, so callers don't cache a lie. */
  error?: string;
};

function firstValue(rows: unknown[], key: string): string | null {
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const v = row[key];
  return v === null || v === undefined ? null : String(v);
}

/**
 * Reads the three facts that together explain whether handle lookups are
 * case-insensitive. Never throws: a broken inspection must not take down
 * whatever called it (notably /health).
 */
export async function inspectHandleCase(
  runSql: SqlRunner,
): Promise<HandleCaseReport> {
  try {
    const citext = firstValue(await runSql(CITEXT_RESOLVABLE_SQL), "t");
    // search_path and the column type are diagnostic context, not the
    // verdict, so one of them failing must not mask the verdict.
    let searchPath: string | null = null;
    let handleColumnType: string | null = null;
    try {
      searchPath = firstValue(await runSql(SEARCH_PATH_SQL), "search_path");
    } catch {
      /* diagnostic only */
    }
    try {
      handleColumnType = firstValue(
        await runSql(HANDLE_COLUMN_TYPE_SQL),
        "t",
      );
    } catch {
      /* diagnostic only */
    }
    return {
      citextResolvable: citext !== null,
      searchPath,
      handleColumnType,
    };
  } catch (err) {
    return {
      citextResolvable: false,
      searchPath: null,
      handleColumnType: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Non-secret description of a connection string, for proving WHICH database
 * a deployment is talking to without revealing how to reach it.
 *
 * The host is reduced to a SHA-256 prefix: two deployments can be compared
 * for equality without either connection string being exposed. Nothing
 * here can round-trip to a credential.
 */
export type ConnectionDescription = {
  hostFingerprint: string | null;
  port: string | null;
  database: string | null;
  /** The thing that silently breaks citext resolution. */
  hasSchemaParam: boolean;
  schemaParam: string | null;
  hasPgbouncerParam: boolean;
};

export function describeConnection(
  url: string | undefined,
): ConnectionDescription {
  if (!url) {
    return {
      hostFingerprint: null,
      port: null,
      database: null,
      hasSchemaParam: false,
      schemaParam: null,
      hasPgbouncerParam: false,
    };
  }
  try {
    const u = new URL(url);
    return {
      hostFingerprint: fingerprint(u.hostname),
      port: u.port || null,
      database: u.pathname.replace(/^\//, "") || null,
      hasSchemaParam: u.searchParams.has("schema"),
      schemaParam: u.searchParams.get("schema"),
      hasPgbouncerParam: u.searchParams.has("pgbouncer"),
    };
  } catch {
    return {
      hostFingerprint: null,
      port: null,
      database: null,
      hasSchemaParam: false,
      schemaParam: null,
      hasPgbouncerParam: false,
    };
  }
}

/** Short, stable, one-way. Long enough that collisions aren't a concern. */
export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
