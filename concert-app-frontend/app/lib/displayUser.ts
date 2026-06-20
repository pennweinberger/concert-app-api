// Display-side helpers for users whose accounts have been anonymized
// (Phase 3 of account lifecycle). The backend keeps the User row but
// strips PII and replaces the handle with `_deleted_<id-suffix>`.
// Frontend renders these as "[deleted user]" without a profile link.

const DELETED_PREFIX = "_deleted_";

export function isDeletedHandle(handle: string | null | undefined): boolean {
  return typeof handle === "string" && handle.startsWith(DELETED_PREFIX);
}

export const DELETED_USER_LABEL = "[deleted user]";
