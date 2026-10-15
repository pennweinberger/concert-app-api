import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ReportMenu from "./ReportMenu";

// Reporting used to be reachable only from the home feed: ReviewCard
// rendered this menu, ReviewItem (show page + profile page) did not. Since
// the feed is time-ordered, a review that scrolled out of it became
// unreportable. These tests pin the contract the new call sites depend on —
// the body that gets POSTed, and the signed-out path.

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  getToken: vi.fn(() => "tok" as string | null),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("../lib/auth", () => ({
  getToken: () => mocks.getToken(),
  authHeaders: () => ({ Authorization: "Bearer tok" }),
}));

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

/** Open the menu, then the modal, then pick a reason. */
function openAndChoose(reasonLabel: string) {
  fireEvent.click(screen.getByLabelText("More options"));
  fireEvent.click(screen.getByText("Report"));
  fireEvent.click(screen.getByLabelText(reasonLabel));
}

beforeEach(() => {
  mocks.push.mockReset();
  mocks.getToken.mockReturnValue("tok");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ReportMenu", () => {
  it("POSTs targetType, targetId and reason to /reports", async () => {
    const fetchMock = fetchStub(() => jsonResponse({ ok: true }, 201));
    vi.stubGlobal("fetch", fetchMock);

    render(<ReportMenu targetType="REVIEW" targetId="rev_1" />);
    openAndChoose("Spam");
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) =>
        c[0].includes("/reports"),
      );
      expect(call).toBeTruthy();
      const init = call![1]!;
      expect(init.method).toBe("POST");
      const body = JSON.parse(String(init.body));
      expect(body.targetType).toBe("REVIEW");
      expect(body.targetId).toBe("rev_1");
      expect(body.reason).toBe("SPAM");
    });
  });

  it("confirms back to the user after a successful report", async () => {
    vi.stubGlobal("fetch", fetchStub(() => jsonResponse({ ok: true }, 201)));
    render(<ReportMenu targetType="REVIEW" targetId="rev_1" />);
    openAndChoose("Spam");
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(screen.getByText("Reported")).toBeTruthy());
  });

  it("sends the viewer to sign-in instead of posting when signed out", async () => {
    mocks.getToken.mockReturnValue(null);
    const fetchMock = fetchStub(() => jsonResponse({ ok: true }, 201));
    vi.stubGlobal("fetch", fetchMock);

    render(<ReportMenu targetType="REVIEW" targetId="rev_1" />);
    openAndChoose("Spam");
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/signin"));
    expect(
      fetchMock.mock.calls.some((c) => c[0].includes("/reports")),
    ).toBe(false);
  });

  it("explains a 403 rather than silently failing", async () => {
    vi.stubGlobal(
      "fetch",
      fetchStub(() => jsonResponse({ reason: "account_suspended" }, 403)),
    );
    render(<ReportMenu targetType="REVIEW" targetId="rev_1" />);
    openAndChoose("Spam");
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(screen.getByText("Your account is suspended.")).toBeTruthy(),
    );
  });

  it("restricts the reason list when reasonsAllowed is given", () => {
    vi.stubGlobal("fetch", fetchStub(() => jsonResponse({}, 200)));
    render(
      <ReportMenu
        targetType="REVIEW"
        targetId="rev_1"
        reasonsAllowed={["SPAM"]}
      />,
    );
    fireEvent.click(screen.getByLabelText("More options"));
    fireEvent.click(screen.getByText("Report"));
    expect(screen.getByLabelText("Spam")).toBeTruthy();
    expect(screen.queryByLabelText("Harassment")).toBeNull();
  });

  it("will not submit before a reason is chosen", () => {
    vi.stubGlobal("fetch", fetchStub(() => jsonResponse({}, 200)));
    render(<ReportMenu targetType="REVIEW" targetId="rev_1" />);
    fireEvent.click(screen.getByLabelText("More options"));
    fireEvent.click(screen.getByText("Report"));
    expect(
      (screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
