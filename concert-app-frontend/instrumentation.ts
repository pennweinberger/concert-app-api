// Next.js instrumentation hook. Called once per server runtime
// (node + edge). We init Sentry here only when a DSN is configured,
// so the SDK is a no-op until the env var is set in Vercel.

export async function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN_AFTERSET) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
