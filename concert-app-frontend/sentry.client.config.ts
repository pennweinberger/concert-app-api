// Client-side Sentry init for the afterset Next.js app.
// SDK is a no-op when NEXT_PUBLIC_SENTRY_DSN_AFTERSET is not set,
// so this file is safe to ship before the env var is configured.

import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN_AFTERSET) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN_AFTERSET,
    environment: process.env.NODE_ENV || "production",
    tracesSampleRate: 0.1,
  });
}
