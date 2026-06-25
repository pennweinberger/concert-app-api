// In-app notifications — creation helper + read/list logic.
//
// Design:
// - createNotification is BEST-EFFORT. It is called AFTER the primary
//   action (follow / like / comment) has already committed, and it
//   never throws back to the caller — a failed notification must not
//   break the action that triggered it. Failures are captured to
//   Sentry so misses are observable.
// - Self-action guard lives here, centrally: if the actor is the
//   recipient, no notification is created. No trigger point can bypass
//   this.
// - Generic shape: `type` is a free string, `entityId` + `metadata`
//   carry per-type payload, so new notification types need no schema
//   or helper change.

import type { PrismaClient } from "@prisma/client";
import * as Sentry from "@sentry/node";

// v1 notification types. Strings, not an enum, matching the schema —
// new types can be added without a migration.
export const NotificationType = {
  FOLLOW: "follow",
  REVIEW_LIKE: "review_like",
  REVIEW_COMMENT: "review_comment",
} as const;

export type CreateNotificationInput = {
  recipientUserId: string;
  actorUserId: string | null;
  type: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type CreateNotificationDeps = {
  prisma: PrismaClient;
};

/**
 * Create a notification, best-effort. Returns true if a row was
 * created, false if skipped (self-action) or suppressed (error). Never
 * throws — safe to call inline after a committed primary action.
 */
export async function createNotification(
  input: CreateNotificationInput,
  deps: CreateNotificationDeps,
): Promise<boolean> {
  // Never notify someone about their own action. Centralized so no
  // trigger point can forget it.
  if (input.actorUserId && input.actorUserId === input.recipientUserId) {
    return false;
  }

  try {
    await deps.prisma.notification.create({
      data: {
        recipientUserId: input.recipientUserId,
        actorUserId: input.actorUserId,
        type: input.type,
        entityId: input.entityId ?? null,
        // Only set metadata when provided — passing `undefined` is
        // rejected under exactOptionalPropertyTypes by Prisma's JSON
        // input type.
        ...(input.metadata != null
          ? { metadata: input.metadata as object }
          : {}),
      },
    });
    return true;
  } catch (err) {
    // Swallow + report. A missed notification is acceptable
    // degradation; breaking the user's action is not.
    Sentry.captureException(err, {
      tags: { area: "notifications", type: input.type },
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// listNotifications — newest-first, cursor pagination, actor hydrated
// ---------------------------------------------------------------------------

export const DEFAULT_NOTIFICATIONS_LIMIT = 20;
export const MAX_NOTIFICATIONS_LIMIT = 50;

export type NotificationActor = {
  handle: string;
  name: string | null;
  avatarUrl: string | null;
};

export type NotificationItem = {
  id: string;
  type: string;
  entityId: string | null;
  metadata: unknown;
  readAt: string | null;
  createdAt: string;
  actor: NotificationActor | null;
};

export type ListNotificationsInput = {
  recipientUserId: string;
  limit: number;
  cursor: Date | null;
};

export type ListNotificationsResult = {
  items: NotificationItem[];
  nextCursor: string | null;
  unreadCount: number;
};

export async function listNotifications(
  input: ListNotificationsInput,
  deps: { prisma: PrismaClient },
): Promise<ListNotificationsResult> {
  // Newest-first cursor pagination. Take limit+1 to detect "more".
  const rows = await deps.prisma.notification.findMany({
    where: {
      recipientUserId: input.recipientUserId,
      ...(input.cursor ? { createdAt: { lt: input.cursor } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    include: {
      actor: { select: { handle: true, name: true, avatarUrl: true } },
    },
  });

  const hasMore = rows.length > input.limit;
  const trimmed = hasMore ? rows.slice(0, input.limit) : rows;
  const items: NotificationItem[] = trimmed.map((n) => ({
    id: n.id,
    type: n.type,
    entityId: n.entityId,
    metadata: n.metadata,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
    actor: n.actor
      ? {
          handle: n.actor.handle,
          name: n.actor.name,
          avatarUrl: n.actor.avatarUrl,
        }
      : null,
  }));

  const last = trimmed[trimmed.length - 1];
  const nextCursor = hasMore && last ? last.createdAt.toISOString() : null;

  const unreadCount = await deps.prisma.notification.count({
    where: { recipientUserId: input.recipientUserId, readAt: null },
  });

  return { items, nextCursor, unreadCount };
}
