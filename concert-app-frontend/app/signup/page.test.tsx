import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import SignUpPage from "./page";

// Regression tests for the signup / Turnstile flow. The server verifies the
// Turnstile token before anything else and tokens are single-use, so the
// form must (a) not submit without a token, (b) never get stuck on
// "Creating account…", and (c) discard the spent token after any failure.

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  setSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("../lib/auth", () => ({ setSession: mocks.setSession }));

type WidgetOpts = {
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
};

/** A stand-in for Cloudflare's window.turnstile. */
function installTurnstile() {
  const widgets: WidgetOpts[] = [];
  const api = {
    render: vi.fn((_el: HTMLElement, opts: Record<string, unknown>) => {
      widgets.push(opts as unknown as WidgetOpts);
      return `widget-${widgets.length}`;
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  window.turnstile = api;
  return { api, latest: () => widgets[widgets.length - 1]! };
}

function issueToken(widget: WidgetOpts, token: string) {
  act(() => widget.callback(token));
}

function fillValidForm() {
  fireEvent.change(screen.getByLabelText("Pick a handle"), {
    target: { value: "new_fan" },
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "fan@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "correct-horse" },
  });
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: /create account|creating account/i,
  }) as HTMLButtonElement;
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sentToken(fetchMock: ReturnType<typeof vi.fn>, call: number) {
  const init = fetchMock.mock.calls[call]![1] as RequestInit;
  return JSON.parse(init.body as string).turnstileToken;
}

/** Waits until the in-flight submission has settled. */
async function settled() {
  await waitFor(() =>
    expect(submitButton().textContent).toBe("Create account"),
  );
}

const SESSION = { token: "jwt", user: { id: "u1", handle: "new_fan" } };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  mocks.replace.mockReset();
  mocks.setSession.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete window.turnstile;
  document
    .querySelectorAll('script[src*="challenges.cloudflare.com"]')
    .forEach((s) => s.remove());
});

describe("signup with Turnstile", () => {
  it("prevents submission before verification", () => {
    installTurnstile();
    render(<SignUpPage />);
    fillValidForm();

    expect(submitButton().disabled).toBe(true);

    // Enter in a field goes through submit() directly, bypassing the
    // disabled button — it must be refused too.
    fireEvent.keyDown(screen.getByLabelText("Password"), { key: "Enter" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(
      /complete the verification/i,
    );
  });

  it("enables signup once Turnstile verifies, and signs the user in", async () => {
    const t = installTurnstile();
    render(<SignUpPage />);
    fillValidForm();

    issueToken(t.latest(), "tok-1");
    expect(submitButton().disabled).toBe(false);

    fetchMock.mockResolvedValueOnce(jsonResponse(201, SESSION));
    fireEvent.click(submitButton());

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
    expect(sentToken(fetchMock, 0)).toBe("tok-1");
    expect(mocks.setSession).toHaveBeenCalledWith("jwt", SESSION.user);
    expect(t.api.reset).not.toHaveBeenCalled();
  });

  it("resets Turnstile after a failed signup and allows a fresh attempt", async () => {
    const t = installTurnstile();
    render(<SignUpPage />);
    fillValidForm();
    issueToken(t.latest(), "tok-1");

    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { error: "Valid email is required" }),
    );
    fireEvent.click(submitButton());
    await settled();

    expect(t.api.reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toBe(
      "Valid email is required",
    );
    // The spent token is gone: no retry until a fresh one arrives.
    expect(submitButton().disabled).toBe(true);

    issueToken(t.latest(), "tok-2");
    expect(submitButton().disabled).toBe(false);

    fetchMock.mockResolvedValueOnce(jsonResponse(201, SESSION));
    fireEvent.click(submitButton());
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
    expect(sentToken(fetchMock, 1)).toBe("tok-2");
  });

  it("does not get stuck after captcha_failed", async () => {
    const t = installTurnstile();
    render(<SignUpPage />);
    fillValidForm();
    issueToken(t.latest(), "tok-1");

    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        error: "captcha_failed",
        message: "Please complete the verification and try again.",
      }),
    );
    fireEvent.click(submitButton());
    await settled();

    expect(screen.getByRole("alert").textContent).toBe(
      "Please complete the verification and try again.",
    );
    expect(t.api.reset).toHaveBeenCalledTimes(1);

    issueToken(t.latest(), "tok-2");
    expect(submitButton().disabled).toBe(false);
  });

  it("does not get stuck on a taken handle, and never reuses the spent token", async () => {
    const t = installTurnstile();
    render(<SignUpPage />);
    fillValidForm();
    issueToken(t.latest(), "tok-1");

    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: "Handle already taken" }),
    );
    fireEvent.click(submitButton());
    await settled();

    expect(screen.getByRole("alert").textContent).toMatch(
      /handle is already taken/i,
    );
    expect(t.api.reset).toHaveBeenCalledTimes(1);
    expect(submitButton().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Pick a handle"), {
      target: { value: "other_fan" },
    });
    issueToken(t.latest(), "tok-2");

    fetchMock.mockResolvedValueOnce(jsonResponse(201, SESSION));
    fireEvent.click(submitButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sentToken(fetchMock, 1)).toBe("tok-2");
  });

  it("recovers from a network error", async () => {
    const t = installTurnstile();
    render(<SignUpPage />);
    fillValidForm();
    issueToken(t.latest(), "tok-1");

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.click(submitButton());
    await settled();

    expect(screen.getByRole("alert").textContent).toMatch(/network error/i);
    expect(t.api.reset).toHaveBeenCalledTimes(1);
  });

  it("shows the server's human-readable message for captcha_unavailable", async () => {
    const t = installTurnstile();
    render(<SignUpPage />);
    fillValidForm();
    issueToken(t.latest(), "tok-1");

    const message =
      "Sign-up is temporarily unavailable. We've been alerted — please try again shortly.";
    fetchMock.mockResolvedValueOnce(
      jsonResponse(503, { error: "captcha_unavailable", message }),
    );
    fireEvent.click(submitButton());
    await settled();

    expect(screen.getByRole("alert").textContent).toBe(message);
    expect(document.body.textContent).not.toContain("captcha_unavailable");
    expect(t.api.reset).toHaveBeenCalledTimes(1);
  });

  describe("missing site key", () => {
    it("fails closed in a production build", () => {
      vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
      vi.stubEnv("NODE_ENV", "production");
      render(<SignUpPage />);
      fillValidForm();

      expect(submitButton().disabled).toBe(true);
      expect(screen.getByRole("alert").textContent).toMatch(
        /verification check isn.t configured/i,
      );

      fireEvent.keyDown(screen.getByLabelText("Password"), { key: "Enter" });
      expect(fetchMock).not.toHaveBeenCalled();
      // No challenge script is requested without a key.
      expect(
        document.querySelector('script[src*="challenges.cloudflare.com"]'),
      ).toBeNull();
    });

    it("stays usable under next dev, for local development", async () => {
      vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
      vi.stubEnv("NODE_ENV", "development");
      render(<SignUpPage />);
      fillValidForm();

      expect(screen.queryByRole("alert")).toBeNull();
      expect(submitButton().disabled).toBe(false);

      fetchMock.mockResolvedValueOnce(jsonResponse(201, SESSION));
      fireEvent.click(submitButton());
      await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
      expect(sentToken(fetchMock, 0)).toBeUndefined();
    });
  });

  describe("Turnstile widget failures stay recoverable", () => {
    it("script load failure: explains, blocks submit, and retries", () => {
      render(<SignUpPage />);
      fillValidForm();

      const script = document.querySelector<HTMLScriptElement>(
        'script[src*="challenges.cloudflare.com"]',
      )!;
      act(() => {
        script.dispatchEvent(new Event("error"));
      });

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toMatch(/couldn.t load the verification/i);
      expect(alert.textContent).toMatch(/refresh/i);
      expect(document.body.textContent).not.toMatch(/still continue/i);
      expect(submitButton().disabled).toBe(true);

      // Retry requests the script again; once it loads the widget renders
      // and a token unblocks the form.
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
      const retried = document.querySelector<HTMLScriptElement>(
        'script[src*="challenges.cloudflare.com"]',
      )!;
      expect(retried).not.toBe(script);

      const t = installTurnstile();
      act(() => {
        retried.dispatchEvent(new Event("load"));
      });
      expect(t.api.render).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/couldn.t load/i)).toBeNull();

      issueToken(t.latest(), "tok-1");
      expect(submitButton().disabled).toBe(false);
    });

    it("widget error callback: explains and blocks submit", () => {
      const t = installTurnstile();
      render(<SignUpPage />);
      fillValidForm();
      issueToken(t.latest(), "tok-1");

      act(() => t.latest()["error-callback"]());

      expect(screen.getByRole("alert").textContent).toMatch(
        /couldn.t load the verification/i,
      );
      expect(submitButton().disabled).toBe(true);
    });

    it("token expiry: blocks submit until verified again", () => {
      const t = installTurnstile();
      render(<SignUpPage />);
      fillValidForm();
      issueToken(t.latest(), "tok-1");
      expect(submitButton().disabled).toBe(false);

      act(() => t.latest()["expired-callback"]());
      expect(submitButton().disabled).toBe(true);
      expect(screen.getByText(/verification expired/i)).toBeTruthy();

      issueToken(t.latest(), "tok-2");
      expect(submitButton().disabled).toBe(false);
      expect(screen.queryByText(/verification expired/i)).toBeNull();
    });
  });
});
