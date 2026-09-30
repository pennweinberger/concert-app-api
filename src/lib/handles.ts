// Handle normalization, shared by registration, login and profile lookup.
//
// Extracted from server.ts so the rules can be tested directly. Behaviour is
// unchanged.
//
// What this DOES do: accept a handle typed with or without a leading `@`,
// tolerate surrounding whitespace, enforce the character set and length, and
// keep leading-underscore handles reserved for system tombstones.
//
// What it deliberately does NOT do: lowercase. Case-insensitivity is enforced
// by the database — User.handle is `citext`, so the unique index and every
// equality lookup ignore case — which means the handle can be stored with the
// capitalization the user chose and still be matched by any casing. Folding
// case here instead would destroy the display form for no benefit. See
// lib/handleCase.ts for the runtime assertion that the database half is
// actually in effect.
//
// Note for anyone tempted to reach for Prisma's `mode: "insensitive"` on a
// handle lookup: don't. It compiles to ILIKE without escaping `_` or `%`, and
// handles may contain underscores (`atd_smoke` exists), so `atd_smoke` would
// also match `atdXsmoke`. citext compares with `=` and has no such hazard.

const HANDLE_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

/**
 * Returns the handle as it should be stored and queried, or null if it is not
 * a valid handle. Capitalization is preserved exactly as supplied.
 */
export function normalizeHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const handle = raw.trim().replace(/^@/, "");
  if (!HANDLE_PATTERN.test(handle)) return null;
  // Reserve leading underscore for system handles (e.g. _deleted_*
  // tombstones from anonymized accounts). Existing users without
  // leading underscore are unaffected.
  if (handle.startsWith("_")) return null;
  return handle;
}
