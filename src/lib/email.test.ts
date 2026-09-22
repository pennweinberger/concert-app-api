import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";

// Mock the resend SDK before importing our wrapper.
const mockSend = vi.fn();
vi.mock("resend", () => ({
  Resend: class FakeResend {
    emails = { send: mockSend };
  },
}));

import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendAccountDeleteConfirmEmail,
  __resetEmailClient,
} from "./email.js";

describe("email lib", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockSend.mockReset();
    __resetEmailClient();
    process.env = { ...originalEnv };
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.WEB_BASE_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("when RESEND_API_KEY is not set (inert)", () => {
    it("sendVerificationEmail returns not_configured without calling Resend", async () => {
      const res = await sendVerificationEmail({
        to: "user@example.com",
        handle: "penn",
        token: "abc123",
      });
      expect(res).toEqual({ sent: false, reason: "not_configured" });
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("sendPasswordResetEmail returns not_configured without calling Resend", async () => {
      const res = await sendPasswordResetEmail({
        to: "user@example.com",
        handle: "penn",
        token: "abc123",
      });
      expect(res).toEqual({ sent: false, reason: "not_configured" });
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("when RESEND_API_KEY is set", () => {
    beforeEach(() => {
      process.env.RESEND_API_KEY = "re_test_123";
    });

    it("sends verification email with the configured WEB_BASE_URL in the link", async () => {
      // Deliberately not a domain we own: this case proves the override is
      // honoured, and the default is asserted separately below.
      process.env.WEB_BASE_URL = "https://staging.example.com";
      mockSend.mockResolvedValueOnce({ data: { id: "msg_1" }, error: null });

      const res = await sendVerificationEmail({
        to: "user@example.com",
        handle: "penn",
        token: "tok123",
      });
      expect(res).toEqual({ sent: true, id: "msg_1" });
      expect(mockSend).toHaveBeenCalledOnce();
      const call = mockSend.mock.calls[0]![0];
      expect(call.to).toBe("user@example.com");
      expect(call.subject).toMatch(/verify/i);
      expect(call.text).toContain(
        "https://staging.example.com/verify-email?token=tok123"
      );
      expect(call.html).toContain(
        "https://staging.example.com/verify-email?token=tok123"
      );
    });

    // The default is compiled in; WEB_BASE_URL only overrides it. Every one
    // of these links carries a single-use token, so a default on a domain we
    // do not own hands those tokens to a stranger on any deploy that forgets
    // the variable. afterset.app is such a stranger — it is not ours — and
    // afterset-pied.vercel.app is the pre-domain alias this replaced.
    describe("the built-in default, when WEB_BASE_URL is not set", () => {
      type SendEmail = (opts: {
        to: string;
        handle: string;
        token: string;
      }) => Promise<unknown>;

      const flows: Array<[string, SendEmail, string]> = [
        ["verification", sendVerificationEmail, "/verify-email"],
        ["password reset", sendPasswordResetEmail, "/reset-password"],
        ["deletion confirm", sendAccountDeleteConfirmEmail, "/confirm-delete"],
      ];

      for (const [flow, sendEmail, path] of flows) {
        it(`${flow} links to the production domain`, async () => {
          mockSend.mockResolvedValueOnce({ data: { id: "m" }, error: null });

          await sendEmail({
            to: "user@example.com",
            handle: "penn",
            token: "tok456",
          });

          const call = mockSend.mock.calls[0]![0];
          for (const body of [call.text as string, call.html as string]) {
            expect(body).toContain(`https://afterset.fm${path}?token=tok456`);
            expect(body).not.toContain("afterset-pied");
            expect(body).not.toContain("afterset.app");
          }
        });
      }
    });

    it("uses EMAIL_FROM when set, else the resend.dev default", async () => {
      mockSend.mockResolvedValueOnce({ data: { id: "msg_3" }, error: null });
      await sendVerificationEmail({
        to: "u@example.com",
        handle: "penn",
        token: "t",
      });
      expect(mockSend.mock.calls[0]![0].from).toBe(
        "Afterset <onboarding@resend.dev>"
      );

      process.env.EMAIL_FROM = "Afterset <hello@afterset.app>";
      __resetEmailClient();
      mockSend.mockResolvedValueOnce({ data: { id: "msg_4" }, error: null });
      await sendVerificationEmail({
        to: "u@example.com",
        handle: "penn",
        token: "t",
      });
      expect(mockSend.mock.calls[1]![0].from).toBe(
        "Afterset <hello@afterset.app>"
      );
    });

    it("URL-encodes the token in case it ever contains URL-special chars", async () => {
      mockSend.mockResolvedValueOnce({ data: { id: "msg" }, error: null });
      await sendVerificationEmail({
        to: "u@example.com",
        handle: "penn",
        token: "abc/123+xyz",
      });
      const text = mockSend.mock.calls[0]![0].text as string;
      expect(text).toContain("abc%2F123%2Bxyz");
    });

    it("returns send_failed when Resend returns an error in the response body", async () => {
      mockSend.mockResolvedValueOnce({
        data: null,
        error: { message: "Invalid recipient" },
      });
      const res = await sendVerificationEmail({
        to: "bogus",
        handle: "penn",
        token: "t",
      });
      expect(res).toEqual({
        sent: false,
        reason: "send_failed",
        error: "Invalid recipient",
      });
    });

    it("returns send_failed when Resend SDK throws", async () => {
      mockSend.mockRejectedValueOnce(new Error("network exploded"));
      const res = await sendVerificationEmail({
        to: "u@example.com",
        handle: "penn",
        token: "t",
      });
      expect(res).toEqual({
        sent: false,
        reason: "send_failed",
        error: "network exploded",
      });
    });

    it("password reset email links to /reset-password", async () => {
      mockSend.mockResolvedValueOnce({ data: { id: "msg" }, error: null });
      await sendPasswordResetEmail({
        to: "u@example.com",
        handle: "penn",
        token: "rs1",
      });
      const call = mockSend.mock.calls[0]![0];
      expect(call.subject).toMatch(/reset/i);
      expect(call.text).toContain("/reset-password?token=rs1");
    });
  });
});
