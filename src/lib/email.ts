// Transactional email — thin abstraction over Resend.
//
// Lazy env-var pattern (same as setlistfm.ts): without RESEND_API_KEY,
// sends return { sent: false, reason: "not_configured" } rather than
// throwing, so dev / preview / first-deploy don't break user-facing
// flows.
//
// TEMPORARY: EMAIL_FROM defaults to a resend.dev address. resend.dev
// works out-of-the-box but emails go through Resend's onboarding domain
// and are clearly unsuitable for public launch. Before opening signups
// to anyone outside the testing circle:
//   1. Buy a real Afterset domain
//   2. Verify it with Resend (DNS records)
//   3. Update EMAIL_FROM env var to a sender on that domain
// This is in the launch-gating list.

import { Resend } from "resend";

const DEFAULT_FROM = "Afterset <onboarding@resend.dev>";

let cachedClient: Resend | null = null;

function getClient(): Resend | null {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  cachedClient = new Resend(apiKey);
  return cachedClient;
}

function getFromAddress(): string {
  return process.env.EMAIL_FROM ?? DEFAULT_FROM;
}

function getWebBaseUrl(): string {
  return (
    process.env.WEB_BASE_URL ?? "https://afterset-pied.vercel.app"
  ).replace(/\/$/, "");
}

export type EmailSendResult =
  | { sent: true; id: string }
  | { sent: false; reason: "not_configured" }
  | { sent: false; reason: "send_failed"; error: string };

async function send(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<EmailSendResult> {
  const client = getClient();
  if (!client) {
    return { sent: false, reason: "not_configured" };
  }
  try {
    const result = await client.emails.send({
      from: getFromAddress(),
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
    if (result.error) {
      return {
        sent: false,
        reason: "send_failed",
        error: result.error.message ?? String(result.error),
      };
    }
    return { sent: true, id: result.data?.id ?? "unknown" };
  } catch (e) {
    return {
      sent: false,
      reason: "send_failed",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---------------------------------------------------------------------------
// Verification email
// ---------------------------------------------------------------------------

export async function sendVerificationEmail(opts: {
  to: string;
  handle: string;
  token: string;
}): Promise<EmailSendResult> {
  const link = `${getWebBaseUrl()}/verify-email?token=${encodeURIComponent(opts.token)}`;
  const subject = "Verify your Afterset email";
  const text = `Hi @${opts.handle},

Welcome to Afterset.

Click the link below to verify your email address:

${link}

This link expires in 24 hours. If you did not sign up, you can ignore this email.

— Afterset`;
  const html = `<p>Hi @${escapeHtml(opts.handle)},</p>
<p>Welcome to Afterset.</p>
<p><a href="${escapeAttr(link)}">Verify your email address</a></p>
<p>This link expires in 24 hours. If you did not sign up, you can ignore this email.</p>
<p>— Afterset</p>`;
  return send({ to: opts.to, subject, text, html });
}

// ---------------------------------------------------------------------------
// Password reset email — used in Phase 2
// ---------------------------------------------------------------------------

export async function sendPasswordResetEmail(opts: {
  to: string;
  handle: string;
  token: string;
}): Promise<EmailSendResult> {
  const link = `${getWebBaseUrl()}/reset-password?token=${encodeURIComponent(opts.token)}`;
  const subject = "Reset your Afterset password";
  const text = `Hi @${opts.handle},

Someone requested a password reset for your Afterset account.

To set a new password, click the link below:

${link}

This link expires in 1 hour. If you did not request a reset, you can ignore this email.

— Afterset`;
  const html = `<p>Hi @${escapeHtml(opts.handle)},</p>
<p>Someone requested a password reset for your Afterset account.</p>
<p><a href="${escapeAttr(link)}">Set a new password</a></p>
<p>This link expires in 1 hour. If you did not request a reset, you can ignore this email.</p>
<p>— Afterset</p>`;
  return send({ to: opts.to, subject, text, html });
}

// ---------------------------------------------------------------------------
// HTML escaping helpers — defensive even though @handle is restricted
// to [A-Za-z0-9_].
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

// Test hook — lets tests reset the cached client between cases.
export function __resetEmailClient(): void {
  cachedClient = null;
}
