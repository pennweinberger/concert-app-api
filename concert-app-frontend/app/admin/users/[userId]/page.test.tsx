import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import AdminUserDetailPage from "./page";

// This page exists because blocking a review or suspending a user resolves
// their reports, which drops the item from the moderation queue and takes
// the Restore / Unsuspend buttons with it. These tests pin the two things
// that made the page necessary: a BLOCKED review must offer Restore, and a
// suspended user must offer Unsuspend — both hitting the existing
// /admin/moderation/* endpoints with the right body.

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  getToken: vi.fn(() => "tok" as string | null),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
  useParams: () => ({ userId: "u_1" }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("../../../lib/auth", () => ({
  getToken: () => mocks.getToken(),
  authHeaders: () => ({ Authorization: "Bearer tok" }),
}));

function detail(over: Record<string, unknown> = {}) {
  return {
    user: {
      id: "u_1",
      handle: "someone",
      name: null,
      avatarUrl: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      suspendedAt: null,
      suspensionReason: null,
      ...((over.user as object) ?? {}),
    },
    reviews: (over.reviews as unknown[]) ?? [],
    openReportCount: (over.openReportCount as number) ?? 0,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

/**
 * A typed fetch stub. `vi.fn(async () => …)` infers an empty call tuple,
 * so `calls[n][0]` would not typecheck — declare the parameters.
 */
function fetchStub(respond: (url: string) => Response) {
  return vi.fn((url: string, _init?: RequestInit) =>
    Promise.resolve(respond(url)),
  );
}

const BLOCKED_REVIEW = {
  id: "rev_blocked",
  reviewTextRaw: "blocked text",
  ratingOverall: 2,
  moderationStatus: "BLOCKED",
  createdAt: "2026-02-02T00:00:00.000Z",
  showId: "show_1",
};

const ALLOWED_REVIEW = {
  id: "rev_ok",
  reviewTextRaw: "fine text",
  ratingOverall: 5,
  moderationStatus: "ALLOWED",
  createdAt: "2026-02-03T00:00:00.000Z",
  showId: "show_2",
};

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.push.mockReset();
  mocks.getToken.mockReturnValue("tok");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("admin user detail", () => {
  it("offers Restore on a BLOCKED review and not on an allowed one", async () => {
    vi.stubGlobal(
      "fetch",
      fetchStub(() =>
        jsonResponse(detail({ reviews: [BLOCKED_REVIEW, ALLOWED_REVIEW] })),
      ),
    );
    render(<AdminUserDetailPage />);

    await waitFor(() => expect(screen.getByText("blocked text")).toBeTruthy());
    expect(screen.getByText("fine text")).toBeTruthy();
    // One Restore button only — for the blocked review.
    expect(screen.getAllByRole("button", { name: "Restore review" })).toHaveLength(1);
  });

  it("POSTs the right body to /admin/moderation/restore", async () => {
    const fetchMock = fetchStub(() =>
      jsonResponse(detail({ reviews: [BLOCKED_REVIEW] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminUserDetailPage />);

    await waitFor(() => expect(screen.getByText("blocked text")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Restore review" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) =>
        c[0].includes("/admin/moderation/restore"),
      );
      expect(call).toBeTruthy();
      const init = call![1]!;
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual({
        targetType: "REVIEW",
        targetId: "rev_blocked",
      });
    });
  });

  it("offers Unsuspend for a suspended user and POSTs the userId", async () => {
    const fetchMock = fetchStub(() =>
      jsonResponse(
        detail({
          user: { suspendedAt: "2026-03-01T00:00:00.000Z", suspensionReason: "spam" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminUserDetailPage />);

    await waitFor(() => expect(screen.getByText(/Reason: spam/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Unsuspend user" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) =>
        c[0].includes("/admin/moderation/unsuspend"),
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]!.body))).toEqual({
        userId: "u_1",
      });
    });
  });

  it("shows no Unsuspend control for an active user", async () => {
    vi.stubGlobal("fetch", fetchStub(() => jsonResponse(detail())));
    render(<AdminUserDetailPage />);

    await waitFor(() => expect(screen.getByText(/not suspended/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Unsuspend user" })).toBeNull();
  });

  it("renders the deleted-user label instead of a raw _deleted_ handle", async () => {
    vi.stubGlobal(
      "fetch",
      fetchStub(() =>
        jsonResponse(detail({ user: { handle: "_deleted_u_1" } })),
      ),
    );
    render(<AdminUserDetailPage />);

    await waitFor(() => expect(screen.getByText("[deleted user]")).toBeTruthy());
    expect(screen.queryByText("@_deleted_u_1")).toBeNull();
  });

  // Permission handling — a non-admin must not see moderation controls.
  it("shows the forbidden state on 403 and renders no actions", async () => {
    vi.stubGlobal("fetch", fetchStub(() => jsonResponse({}, 403)));
    render(<AdminUserDetailPage />);

    await waitFor(() => expect(screen.getByText(/don’t have access/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Restore review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unsuspend user" })).toBeNull();
  });

  it("redirects to sign-in when there is no token", async () => {
    mocks.getToken.mockReturnValue(null);
    vi.stubGlobal("fetch", fetchStub(() => jsonResponse(detail())));
    render(<AdminUserDetailPage />);

    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/signin?next=/admin/users/u_1"),
    );
  });

  it("reports a missing user rather than rendering an empty page", async () => {
    vi.stubGlobal("fetch", fetchStub(() => jsonResponse({}, 404)));
    render(<AdminUserDetailPage />);
    await waitFor(() => expect(screen.getByText(/No user with that id/)).toBeTruthy());
  });
});
