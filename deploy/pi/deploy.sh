#!/usr/bin/env bash
# Builds the API bundle on this machine and copies it to the Pi. Nothing is installed with pnpm on the Pi.
# Usage: deploy/pi/deploy.sh user@host   (e.g. ggabry@100.84.50.10). Uses the ssh key you already have for the Pi.
# It restarts the ehub-api service, so run it only when you mean to.
# Normally you don't need it: the Pi pulls every push to main by itself (ehub-update.timer, see docs/hosting.md).
# A manual deploy leaves no /opt/ehub/VERSION, so the timer puts the latest release back within a couple of minutes:
# to keep a manual build running, `sudo touch /etc/ehub/no-auto-update` on the Pi first.
set -euo pipefail
# Extra ssh options, e.g. SSH_OPTS="-i ~/.ssh/id_ed25519_py".
SSH_OPTS="${SSH_OPTS:-}"
TARGET="${1:?usage: deploy.sh user@host}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
"$ROOT/deploy/pi/stage.sh" "$STAGE"

ssh $SSH_OPTS "$TARGET" 'mkdir -p /tmp/ehub-release'
rsync -e "ssh $SSH_OPTS" -az --delete "$STAGE/" "$TARGET:/tmp/ehub-release/"
ssh $SSH_OPTS "$TARGET" 'sudo install -d /opt/ehub && sudo rsync -a --delete /tmp/ehub-release/ /opt/ehub/ && sudo cp /opt/ehub/units/* /etc/systemd/system/ && sudo install -m 755 /opt/ehub/ehub-update.sh /usr/local/bin/ehub-update && sudo systemctl daemon-reload && sudo systemctl restart ehub-api && sudo systemctl enable --now ehub-update.timer; sudo systemctl disable --now ehub-kobo-sync.timer 2>/dev/null || true'  # the Kobo is synced by hand ("Sincronizza ora")
