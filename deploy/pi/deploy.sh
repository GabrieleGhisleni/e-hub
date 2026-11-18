#!/usr/bin/env bash
# Builds the API bundle on this machine and copies it to the Pi. Nothing is installed with pnpm on the Pi.
# Usage: deploy/pi/deploy.sh user@host   (e.g. ggabry@100.84.50.10). Uses the ssh key you already have for the Pi.
# It restarts the ehub-api service, so run it only when you mean to.
set -euo pipefail
# Extra ssh options, e.g. SSH_OPTS="-i ~/.ssh/id_ed25519_py".
SSH_OPTS="${SSH_OPTS:-}"
TARGET="${1:?usage: deploy.sh user@host}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SHARP_VERSION="$(node -p "require('$ROOT/packages/library/package.json').dependencies.sharp.replace(/^[^0-9]*/, '')")"

pnpm --dir "$ROOT" --filter @ehub/api bundle

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp "$ROOT/apps/api/dist/ehub-api.mjs" "$ROOT/apps/api/dist/ehub-kobo-sync.mjs" "$STAGE/"
cp "$ROOT/deploy/pi/elib.config.json" "$STAGE/"
# sharp is native: fetch its linux-arm64 build (no compiling, no pnpm on the Pi).
( cd "$STAGE" && npm init -y >/dev/null && npm install --omit=dev --os=linux --cpu=arm64 "sharp@$SHARP_VERSION" >/dev/null )

ssh $SSH_OPTS "$TARGET" 'mkdir -p /tmp/ehub-release/units'
rsync -e "ssh $SSH_OPTS" -az --delete --exclude units "$STAGE/ehub-api.mjs" "$STAGE/ehub-kobo-sync.mjs" "$STAGE/elib.config.json" "$STAGE/node_modules" "$TARGET:/tmp/ehub-release/"
rsync -e "ssh $SSH_OPTS" -az "$ROOT/deploy/pi/"*.service "$ROOT/deploy/pi/"*.timer "$TARGET:/tmp/ehub-release/units/"
ssh $SSH_OPTS "$TARGET" 'sudo install -d /opt/ehub && sudo rsync -a --delete /tmp/ehub-release/ /opt/ehub/ && sudo cp /opt/ehub/units/* /etc/systemd/system/ 2>/dev/null; sudo systemctl daemon-reload && sudo systemctl restart ehub-api; sudo systemctl enable --now ehub-kobo-sync.timer'
