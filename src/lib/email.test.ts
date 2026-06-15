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
      process.env.WEB_BASE_URL = "https://afterset.app";
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
      expect(call.text).toContain("https://afterset.app/verify-email?token=tok123");
      expect(call.html).toContain("https://afterset.app/verify-email?token=tok123");
    });

    it("uses the default WEB_BASE_URL when not set", async () => {
      mockSend.mockResolvedValueOnce({ data: { id: "msg_2" }, error: null });
      await sendVerificationEmail({
        to: "user@example.com",
        handle: "penn",
        token: "tok456",
      });
      const call = mockSend.mock.calls[0]![0];
      expect(call.text).toContain("https://afterset-pied.vercel.app/verify-email?token=tok456");
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
