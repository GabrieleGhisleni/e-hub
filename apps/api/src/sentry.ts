/**
 * Sentry (errors + response times) for the API. Import it first in the entry points: it reads `.env.local` itself,
 * because the DSN must be known before the rest of the code runs. Without SENTRY_DSN nothing is sent (tests, dev
 * without a key). Never put the DSN in the repo: `.env.local` on the laptop, `/etc/ehub/env` on the Pi.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as Sentry from "@sentry/node";
import { loadEnvLocal } from "@ehub/store";

loadEnvLocal(process.cwd());
loadEnvLocal(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."));

const dsn = process.env.SENTRY_DSN?.trim();
if (dsn) {
  const rate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "1");
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || (process.env.API_DEV_OWNER_EMAIL ? "development" : "production"),
    release: process.env.SENTRY_RELEASE || undefined,
    tracesSampleRate: Number.isFinite(rate) ? rate : 1,
    // Personal data (emails, cookies, IPs) stays out: it is a multi-user app with private libraries.
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
      }
      return event;
    },
    // The health check is polled constantly: it would drown the performance view.
    ignoreSpans: [{ name: /\/api\/health$/ }],
  });
}

export { Sentry };
