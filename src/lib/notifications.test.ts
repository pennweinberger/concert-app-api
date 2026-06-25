import { describe, it, expect, vi } from "vitest";
import {
  createNotification,
  listNotifications,
  NotificationType,
} from "./notifications.js";

function makeMockPrisma() {
  const create = vi.fn().mockResolvedValue({ id: "n_1" });
  const findMany = vi.fn().mockResolvedValue([]);
  const count = vi.fn().mockResolvedValue(0);
  return {
    prisma: {
      notification: { create, findMany, count },
    } as unknown as import("@prisma/client").PrismaClient,
    mocks: { create, findMany, count },
  };
}

// ---------------------------------------------------------------------------
// createNotification
// ---------------------------------------------------------------------------

describe("createNotification", () => {
  it("creates a notification for a normal cross-user action", async () => {
    const { prisma, mocks } = makeMockPrisma();
    const made = await createNotification(
      {
        recipientUserId: "u_author",
        actorUserId: "u_actor",
        type: NotificationType.REVIEW_LIKE,
        entityId: "review_1",
      },
      { prisma },
    );
    expect(made).toBe(true);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.create.mock.calls[0]![0].data).toMatchObject({
      recipientUserId: "u_author",
      actorUserId: "u_actor",
      type: "review_like",
      entityId: "review_1",
    });
  });

  it("SKIPS self-actions (actor === recipient) and writes nothing", async () => {
    const { prisma, mocks } = makeMockPrisma();
    const made = await createNotification(
      {
        recipientUserId: "u_same",
        actorUserId: "u_same",
        type: NotificationType.REVIEW_COMMENT,
        entityId: "review_1",
      },
      { prisma },
    );
    expect(made).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does NOT throw when the DB write fails — returns false (best-effort)", async () => {
    const create = vi.fn().mockRejectedValue(new Error("db down"));
    const prisma = {
      notification: { create },
    } as unknown as import("@prisma/client").PrismaClient;
    const made = await createNotification(
      {
        recipientUserId: "u_a",
        actorUserId: "u_b",
        type: NotificationType.FOLLOW,
        entityId: "u_b",
      },
      { prisma },
    );
    expect(made).toBe(false); // suppressed, not thrown
  });

  it("allows a system notification with null actor", async () => {
    const { prisma, mocks } = makeMockPrisma();
    const made = await createNotification(
      {
        recipientUserId: "u_a",
        actorUserId: null,
        type: "system_announcement",
        metadata: { msg: "hello" },
      },
      { prisma },
    );
    expect(made).toBe(true);
    expect(mocks.create.mock.calls[0]![0].data.actorUserId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listNotifications
// ---------------------------------------------------------------------------

describe("listNotifications", () => {
  function row(id: string, createdAt: string, readAt: string | null = null) {
    return {
      id,
      type: "review_like",
      entityId: "review_1",
      metadata: null,
      readAt: readAt ? new Date(readAt) : null,
      createdAt: new Date(createdAt),
      actor: { handle: "liker", name: "Liker", avatarUrl: null },
    };
  }

  it("returns items newest-first with unreadCount and no nextCursor when under limit", async () => {
    const { prisma, mocks } = makeMockPrisma();
    mocks.findMany.mockResolvedValue([
      row("n2", "2026-06-25T02:00:00.000Z"),
      row("n1", "2026-06-25T01:00:00.000Z"),
    ]);
    mocks.count.mockResolvedValue(2);

    const res = await listNotifications(
      { recipientUserId: "u_a", limit: 20, cursor: null },
      { prisma },
    );
    expect(res.items.map((i) => i.id)).toEqual(["n2", "n1"]);
    expect(res.nextCursor).toBeNull();
    expect(res.unreadCount).toBe(2);
    expect(res.items[0]!.actor!.handle).toBe("liker");
  });

  it("sets nextCursor when there are more than `limit` rows (takes limit+1)", async () => {
    const { prisma, mocks } = makeMockPrisma();
    // limit=2 → take 3; return 3 → hasMore, trim to 2, cursor = 2nd row's createdAt
    mocks.findMany.mockResolvedValue([
      row("n3", "2026-06-25T03:00:00.000Z"),
      row("n2", "2026-06-25T02:00:00.000Z"),
      row("n1", "2026-06-25T01:00:00.000Z"),
    ]);
    const res = await listNotifications(
      { recipientUserId: "u_a", limit: 2, cursor: null },
      { prisma },
    );
    expect(res.items.map((i) => i.id)).toEqual(["n3", "n2"]);
    expect(res.nextCursor).toBe("2026-06-25T02:00:00.000Z");
  });

  it("applies the cursor as createdAt < cursor (older page)", async () => {
    const { prisma, mocks } = makeMockPrisma();
    const cursor = new Date("2026-06-25T02:00:00.000Z");
    await listNotifications(
      { recipientUserId: "u_a", limit: 20, cursor },
      { prisma },
    );
    const where = mocks.findMany.mock.calls[0]![0].where;
    expect(where.createdAt).toEqual({ lt: cursor });
    expect(where.recipientUserId).toBe("u_a");
  });
});
