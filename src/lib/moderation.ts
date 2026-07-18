// Shared moderation visibility fragments. Single source of truth so
// every public-facing review/comment read + count + aggregate excludes
// BLOCKED content consistently (no per-endpoint drift). Admin queries
// deliberately omit these so moderators can still see blocked content.

// Prisma `where` fragment: content that is NOT blocked. Applies to both
// Review and ReviewComment (both carry moderationStatus).
export const NOT_BLOCKED = {
  moderationStatus: { not: "BLOCKED" as const },
};

// Relation-count fragment for `_count: { select: { ... } }` so counts of
// reviews/comments exclude blocked rows.
export const NOT_BLOCKED_COUNT = { where: NOT_BLOCKED };
