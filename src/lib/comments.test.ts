import { describe, it, expect, vi, beforeEach } from "vitest";
import { createComment, deleteComment, listComments } from "./comments.js";

function makeMockPrisma() {
  const findReviewUnique = vi.fn();
  const createReviewComment = vi.fn();
  const deleteManyReviewComments = vi.fn();
  const findManyReviewComments = vi.fn();

  return {
    prisma: {
      review: { findUnique: findReviewUnique },
      reviewComment: {
        create: createReviewComment,
        deleteMany: deleteManyReviewComments,
        findMany: findManyReviewComments,
      },
    } as unknown as import("@prisma/client").PrismaClient,
    mocks: {
      findReviewUnique,
      createReviewComment,
      deleteManyReviewComments,
      findManyReviewComments,
    },
  };
}

// ---------------------------------------------------------------------------
// createComment
// ---------------------------------------------------------------------------

describe("createComment", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("body_too_short for empty / whitespace-only body — no DB hit", async () => {
    for (const body of ["", "   ", "\n\n", undefined as unknown as string]) {
      const result = await createComment(
        { reviewId: "r1", userId: "u1", body },
        { prisma: setup.prisma },
      );
      expect(result).toEqual({ ok: false, reason: "body_too_short" });
    }
    expect(setup.mocks.findReviewUnique).not.toHaveBeenCalled();
    expect(setup.mocks.createReviewComment).not.toHaveBeenCalled();
  });

  it("body_too_long for >2000 chars — no DB hit", async () => {
    const result = await createComment(
      { reviewId: "r1", userId: "u1", body: "x".repeat(2001) },
      { prisma: setup.prisma },
    );
    expect(result).toEqual({ ok: false, reason: "body_too_long" });
    expect(setup.mocks.findReviewUnique).not.toHaveBeenCalled();
  });

  it("accepts exactly 1 and 2000 char boundaries", async () => {
    for (const len of [1, 2000]) {
      setup = makeMockPrisma();
      setup.mocks.findReviewUnique.mockResolvedValueOnce({ id: "r1" });
      setup.mocks.createReviewComment.mockResolvedValueOnce({
        id: "c_new",
        reviewId: "r1",
        body: "a".repeat(len),
        createdAt: new Date("2026-06-20T00:00:00.000Z"),
        user: { handle: "penn", name: null, avatarUrl: null },
      });
      const result = await createComment(
        { reviewId: "r1", userId: "u1", body: "a".repeat(len) },
        { prisma: setup.prisma },
      );
      expect(result.ok).toBe(true);
    }
  });

  it("review_not_found when the review does not exist", async () => {
    setup.mocks.findReviewUnique.mockResolvedValueOnce(null);
    const result = await createComment(
      { reviewId: "ghost", userId: "u1", body: "looks great" },
      { prisma: setup.prisma },
    );
    expect(result).toEqual({ ok: false, reason: "review_not_found" });
    expect(setup.mocks.createReviewComment).not.toHaveBeenCalled();
  });

  it("trims whitespace before validation and storage", async () => {
    setup.mocks.findReviewUnique.mockResolvedValueOnce({ id: "r1" });
    setup.mocks.createReviewComment.mockResolvedValueOnce({
      id: "c1",
      reviewId: "r1",
      body: "great show",
      createdAt: new Date("2026-06-20T00:00:00.000Z"),
      user: { handle: "penn", name: null, avatarUrl: null },
    });
    await createComment(
      { reviewId: "r1", userId: "u1", body: "   great show   \n" },
      { prisma: setup.prisma },
    );
    const createCall = setup.mocks.createReviewComment.mock.calls[0]![0];
    expect(createCall.data.body).toBe("great show");
  });

  it("happy path: persists then returns shape with author handle/name/avatar", async () => {
    setup.mocks.findReviewUnique.mockResolvedValueOnce({
      id: "r1",
      userId: "review_author",
    });
    setup.mocks.createReviewComment.mockResolvedValueOnce({
      id: "c_id",
      reviewId: "r1",
      body: "great show",
      createdAt: new Date("2026-06-20T00:00:00.000Z"),
      user: {
        handle: "penn",
        name: "Penn",
        avatarUrl: "https://example.com/p.jpg",
      },
    });

    const result = await createComment(
      { reviewId: "r1", userId: "u1", body: "great show" },
      { prisma: setup.prisma },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // The review author is surfaced for the notification trigger.
      expect(result.reviewAuthorUserId).toBe("review_author");
      expect(result.comment).toEqual({
        id: "c_id",
        reviewId: "r1",
        body: "great show",
        createdAt: new Date("2026-06-20T00:00:00.000Z"),
        userHandle: "penn",
        userName: "Penn",
        userAvatarUrl: "https://example.com/p.jpg",
      });
    }
  });
});

// ---------------------------------------------------------------------------
// deleteComment — anti-enumeration
// ---------------------------------------------------------------------------

describe("deleteComment", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("deletes when the comment exists, belongs to the user, and matches the review", async () => {
    setup.mocks.deleteManyReviewComments.mockResolvedValueOnce({ count: 1 });
    const result = await deleteComment(
      { commentId: "c1", reviewId: "r1", userId: "u1" },
      { prisma: setup.prisma },
    );
    expect(result).toEqual({ ok: true });
    expect(setup.mocks.deleteManyReviewComments).toHaveBeenCalledWith({
      where: { id: "c1", reviewId: "r1", userId: "u1" },
    });
  });

  it("not_found when comment does not exist (count=0)", async () => {
    setup.mocks.deleteManyReviewComments.mockResolvedValueOnce({ count: 0 });
    const result = await deleteComment(
      { commentId: "ghost", reviewId: "r1", userId: "u1" },
      { prisma: setup.prisma },
    );
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("not_found (same response) when the comment exists but is not owned — anti-enumeration", async () => {
    // The deleteMany scoped by userId returns count=0 in this case
    // — we can't tell the difference between "does not exist" and
    // "exists but owned by someone else". Confirm both surface as
    // not_found.
    setup.mocks.deleteManyReviewComments.mockResolvedValueOnce({ count: 0 });
    const result = await deleteComment(
      { commentId: "c_real_but_not_yours", reviewId: "r1", userId: "u1" },
      { prisma: setup.prisma },
    );
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});

// ---------------------------------------------------------------------------
// listComments
// ---------------------------------------------------------------------------

describe("listComments", () => {
  let setup: ReturnType<typeof makeMockPrisma>;
  beforeEach(() => {
    setup = makeMockPrisma();
  });

  it("review_not_found when the review id does not exist", async () => {
    setup.mocks.findReviewUnique.mockResolvedValueOnce(null);
    const result = await listComments(
      { reviewId: "ghost", limit: 20, cursor: null },
      { prisma: setup.prisma },
    );
    expect(result).toEqual({ ok: false, reason: "review_not_found" });
    expect(setup.mocks.findManyReviewComments).not.toHaveBeenCalled();
  });

  it("returns items + null nextCursor when fewer rows than limit", async () => {
    setup.mocks.findReviewUnique.mockResolvedValueOnce({ id: "r1" });
    setup.mocks.findManyReviewComments.mockResolvedValueOnce([
      {
        id: "c1",
        body: "first",
        createdAt: new Date("2026-06-20T10:00:00.000Z"),
        user: { handle: "alice", name: null, avatarUrl: null },
      },
    ]);
    const result = await listComments(
      { reviewId: "r1", limit: 20, cursor: null },
      { prisma: setup.prisma },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items.length).toBe(1);
      expect(result.items[0]!.body).toBe("first");
      expect(result.nextCursor).toBeNull();
    }
  });

  it("returns nextCursor when there are more rows than limit", async () => {
    setup.mocks.findReviewUnique.mockResolvedValueOnce({ id: "r1" });
    // Return limit+1 to signal "more".
    setup.mocks.findManyReviewComments.mockResolvedValueOnce([
      {
        id: "c1",
        body: "a",
        createdAt: new Date("2026-06-20T10:00:00.000Z"),
        user: { handle: "alice", name: null, avatarUrl: null },
      },
      {
        id: "c2",
        body: "b",
        createdAt: new Date("2026-06-20T11:00:00.000Z"),
        user: { handle: "bob", name: null, avatarUrl: null },
      },
      {
        id: "c3-overflow",
        body: "c",
        createdAt: new Date("2026-06-20T12:00:00.000Z"),
        user: { handle: "carol", name: null, avatarUrl: null },
      },
    ]);
    const result = await listComments(
      { reviewId: "r1", limit: 2, cursor: null },
      { prisma: setup.prisma },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items.length).toBe(2);
      expect(result.items.map((i) => i.id)).toEqual(["c1", "c2"]);
      expect(result.nextCursor).toBe("2026-06-20T11:00:00.000Z");
    }
  });

  it("queries with the right where clause: filters BLOCKED, applies cursor when set", async () => {
    setup.mocks.findReviewUnique.mockResolvedValueOnce({ id: "r1" });
    setup.mocks.findManyReviewComments.mockResolvedValueOnce([]);
    const cursor = new Date("2026-06-20T10:00:00.000Z");
    await listComments(
      { reviewId: "r1", limit: 20, cursor },
      { prisma: setup.prisma },
    );
    const findArg = setup.mocks.findManyReviewComments.mock.calls[0]![0];
    expect(findArg.where.reviewId).toBe("r1");
    expect(findArg.where.moderationStatus).toEqual({ not: "BLOCKED" });
    expect(findArg.where.createdAt).toEqual({ gt: cursor });
    expect(findArg.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
    expect(findArg.take).toBe(21); // limit + 1
  });
});
