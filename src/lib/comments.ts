// Review comments — pure handler functions with deps injected so the
// HTTP routes can stay thin. createComment + deleteComment + listComments
// can be unit-tested directly against a mocked Prisma client.
//
// Design priorities:
// - Anti-enumeration on delete: not-owner is reported the same as
//   not-found, so callers cannot tell whether a comment they do not own
//   actually exists.
// - Cursor pagination, oldest-first — reads like conversation.
// - Default new comments to moderationStatus = PENDING and filter
//   BLOCKED out of public lists. The PENDING-by-default state
//   effectively auto-allows until admin moderation tools exist; this
//   is a documented launch-gating item.

import type { PrismaClient } from "@prisma/client";

const MIN_BODY = 1;
const MAX_BODY = 2000;

export const DEFAULT_COMMENTS_LIMIT = 20;
export const MAX_COMMENTS_LIMIT = 100;

// ---------------------------------------------------------------------------
// createComment
// ---------------------------------------------------------------------------

export type CreateCommentDeps = {
  prisma: PrismaClient;
};

export type CreateCommentInput = {
  reviewId: string;
  userId: string;
  body: string;
};

export type CreatedComment = {
  id: string;
  reviewId: string;
  body: string;
  createdAt: Date;
  userHandle: string;
  userName: string | null;
  userAvatarUrl: string | null;
};

export type CreateCommentResult =
  | {
      ok: true;
      comment: CreatedComment;
      /** Author of the review being commented on — the notification
       *  recipient. Surfaced here so the route can fire a best-effort
       *  notification without re-querying the review. */
      reviewAuthorUserId: string;
      /** Show the review belongs to — lets the notification deep-link
       *  to the show page where the review renders. */
      reviewShowId: string;
    }
  | {
      ok: false;
      reason: "review_not_found" | "body_too_short" | "body_too_long";
    };

export async function createComment(
  input: CreateCommentInput,
  deps: CreateCommentDeps,
): Promise<CreateCommentResult> {
  const trimmed = typeof input.body === "string" ? input.body.trim() : "";
  if (trimmed.length < MIN_BODY) {
    return { ok: false, reason: "body_too_short" };
  }
  if (trimmed.length > MAX_BODY) {
    return { ok: false, reason: "body_too_long" };
  }

  const review = await deps.prisma.review.findUnique({
    where: { id: input.reviewId },
    select: { id: true, userId: true, showId: true },
  });
  if (!review) {
    return { ok: false, reason: "review_not_found" };
  }

  const created = await deps.prisma.reviewComment.create({
    data: {
      reviewId: input.reviewId,
      userId: input.userId,
      body: trimmed,
    },
    include: {
      user: { select: { handle: true, name: true, avatarUrl: true } },
    },
  });

  return {
    ok: true,
    reviewAuthorUserId: review.userId,
    reviewShowId: review.showId,
    comment: {
      id: created.id,
      reviewId: created.reviewId,
      body: created.body,
      createdAt: created.createdAt,
      userHandle: created.user.handle,
      userName: created.user.name,
      userAvatarUrl: created.user.avatarUrl,
    },
  };
}

// ---------------------------------------------------------------------------
// deleteComment
// ---------------------------------------------------------------------------

export type DeleteCommentDeps = {
  prisma: PrismaClient;
};

export type DeleteCommentInput = {
  commentId: string;
  reviewId: string;
  userId: string;
};

export type DeleteCommentResult =
  | { ok: true }
  | { ok: false; reason: "not_found" };

export async function deleteComment(
  input: DeleteCommentInput,
  deps: DeleteCommentDeps,
): Promise<DeleteCommentResult> {
  // Single deleteMany scoped by ownership: result.count === 0 covers
  // both "comment does not exist" and "comment exists but is not
  // owned by this user". We deliberately collapse those into the same
  // anti-enumeration response so the caller cannot probe for the
  // existence of other people's comments.
  const result = await deps.prisma.reviewComment.deleteMany({
    where: {
      id: input.commentId,
      reviewId: input.reviewId,
      userId: input.userId,
    },
  });
  if (result.count === 0) {
    return { ok: false, reason: "not_found" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// listComments
// ---------------------------------------------------------------------------

export type ListCommentsDeps = {
  prisma: PrismaClient;
};

export type ListCommentsInput = {
  reviewId: string;
  limit: number;
  cursor: Date | null;
};

export type CommentItem = {
  id: string;
  body: string;
  createdAt: Date;
  userHandle: string;
  userName: string | null;
  userAvatarUrl: string | null;
};

export type ListCommentsResult =
  | { ok: true; items: CommentItem[]; nextCursor: string | null }
  | { ok: false; reason: "review_not_found" };

export async function listComments(
  input: ListCommentsInput,
  deps: ListCommentsDeps,
): Promise<ListCommentsResult> {
  const review = await deps.prisma.review.findUnique({
    where: { id: input.reviewId },
    select: { id: true },
  });
  if (!review) {
    return { ok: false, reason: "review_not_found" };
  }

  // Oldest-first cursor pagination. Take limit+1 to detect "more after".
  const rows = await deps.prisma.reviewComment.findMany({
    where: {
      reviewId: input.reviewId,
      moderationStatus: { not: "BLOCKED" },
      ...(input.cursor ? { createdAt: { gt: input.cursor } } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: input.limit + 1,
    include: {
      user: { select: { handle: true, name: true, avatarUrl: true } },
    },
  });

  const hasMore = rows.length > input.limit;
  const trimmed = hasMore ? rows.slice(0, input.limit) : rows;
  const items: CommentItem[] = trimmed.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.createdAt,
    userHandle: r.user.handle,
    userName: r.user.name,
    userAvatarUrl: r.user.avatarUrl,
  }));

  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? last.createdAt.toISOString() : null;

  return { ok: true, items, nextCursor };
}
