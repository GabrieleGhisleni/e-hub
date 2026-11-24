import * as Sentry from "@sentry/react";

/**
 * Sentry in the browser: errors and page-load / navigation timings. Off without VITE_SENTRY_DSN (dev, tests).
 * The DSN of a browser project is public by design; the site build gets it from the Pages workflow.
 */
const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
if (dsn) {
  Sentry.init({
    dsn,
    environment: "production",
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 1,
    // No trace headers to the API: its CORS list does not include them and requests stay as they are.
    tracePropagationTargets: [],
  });
}

export { Sentry };
