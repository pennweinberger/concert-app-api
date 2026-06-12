// Server-side Sentry init (Node runtime) for the afterset Next.js app.
// Loaded by instrumentation.ts when NEXT_PUBLIC_SENTRY_DSN_AFTERSET
// is set.

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN_AFTERSET,
  environment: process.env.NODE_ENV || "production",
  tracesSampleRate: 0.1,
});
