#!/usr/bin/env bash
# Builds the API bundle and lays out in DIR what goes into /opt/ehub on the Pi: the two bundles, elib.config.json,
# sharp for linux-arm64 (no compiling, no pnpm on the Pi), the systemd units and the self-updater.
# Used by deploy.sh (from the laptop) and by .github/workflows/api-release.yml (the release the Pi pulls).
# Usage: deploy/pi/stage.sh DIR
set -euo pipefail
STAGE="${1:?usage: stage.sh DIR}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SHARP_VERSION="$(node -p "require('$ROOT/packages/library/package.json').dependencies.sharp.replace(/^[^0-9]*/, '')")"

pnpm --dir "$ROOT" --filter @ehub/api bundle

mkdir -p "$STAGE/units"
cp "$ROOT/apps/api/dist/ehub-api.mjs" "$ROOT/apps/api/dist/ehub-kobo-sync.mjs" "$ROOT/deploy/pi/elib.config.json" "$STAGE/"
install -m 755 "$ROOT/deploy/pi/ehub-update.sh" "$STAGE/ehub-update.sh"
cp "$ROOT/deploy/pi/"*.service "$ROOT/deploy/pi/"*.timer "$STAGE/units/"
# Sentry's Hono/http span hooks are loaded from this package at run time; the bundle cannot include it.
SENTRY_VERSION="$(node -p "require('$ROOT/apps/api/package.json').dependencies['@sentry/node'].replace(/^[^0-9]*/, '')")"
( cd "$STAGE" && npm init -y >/dev/null && npm install --omit=dev --os=linux --cpu=arm64 "sharp@$SHARP_VERSION" "@sentry/server-runtime-injection@$SENTRY_VERSION" >/dev/null && rm -f package.json package-lock.json )
