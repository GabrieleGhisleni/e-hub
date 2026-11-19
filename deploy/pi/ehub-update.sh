#!/usr/bin/env bash
# Runs on the Pi as root, from ehub-update.timer every 2 minutes. Installs the latest API release published by
# .github/workflows/api-release.yml (rolling release "api-latest"), only if it is newer than /opt/ehub/VERSION.
# Download and checksum first, then swap folders, restart ehub-api and check /api/health; if the API doesn't come up,
# put the previous folder back and remember the bad version so it is not retried. Nothing is exposed to the Internet.
# `touch /etc/ehub/no-auto-update` pauses it (e.g. to keep a manual deploy.sh build running).
set -euo pipefail
REPO="${EHUB_UPDATE_REPO:-GabrieleGhisleni/e-hub}"
BASE="https://github.com/$REPO/releases/download/api-latest"
APP=/opt/ehub
STATE=/var/lib/ehub-update
HEALTH="http://127.0.0.1:${EHUB_PORT:-8788}/api/health"

[ -e /etc/ehub/no-auto-update ] && exit 0
mkdir -p "$STATE"

# version.txt: "<commit> <sha256 of ehub-api.tar.gz>". Not there yet (or GitHub unreachable): try again next time.
read -r version checksum < <(curl -fsSL --max-time 20 "$BASE/version.txt") || exit 0
[[ "$version" =~ ^[0-9a-f]{40}$ && "$checksum" =~ ^[0-9a-f]{64}$ ]] || { echo "malformed version.txt"; exit 0; }
[ "$version" = "$(cat "$APP/VERSION" 2>/dev/null)" ] && exit 0
[ "$version" = "$(cat "$STATE/failed" 2>/dev/null)" ] && exit 0

echo "installing ${version:0:7} (now: $(cut -c1-7 "$APP/VERSION" 2>/dev/null || echo none))"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp" "$APP.new"' EXIT
curl -fsSL --max-time 300 -o "$tmp/ehub-api.tar.gz" "$BASE/ehub-api.tar.gz"
# The tarball may still be the previous one while the workflow uploads: the checksum catches it, the next run retries.
echo "$checksum  $tmp/ehub-api.tar.gz" | sha256sum -c --quiet - || { echo "checksum mismatch, retrying later"; exit 0; }
rm -rf "$APP.new"; mkdir "$APP.new"
tar -xzf "$tmp/ehub-api.tar.gz" -C "$APP.new" --no-same-owner
[ -f "$APP.new/ehub-api.mjs" ] || { echo "release without ehub-api.mjs"; exit 1; }
echo "$version" > "$APP.new/VERSION"

healthy() {
  for _ in $(seq 30); do curl -fs --max-time 3 "$HEALTH" >/dev/null && return 0; sleep 2; done
  return 1
}
units_and_restart() {
  cp "$APP"/units/* /etc/systemd/system/
  systemctl daemon-reload
  systemctl restart ehub-api
}

rm -rf "$APP.prev"
[ -d "$APP" ] && mv "$APP" "$APP.prev"
mv "$APP.new" "$APP"
units_and_restart
if healthy; then
  # New inode, so a running copy of this script is not overwritten under itself.
  cp "$APP/ehub-update.sh" /usr/local/bin/.ehub-update.new && mv -f /usr/local/bin/.ehub-update.new /usr/local/bin/ehub-update
  rm -f "$STATE/failed"
  echo "installed ${version:0:7}"
  exit 0
fi

echo "${version:0:7} did not answer on /api/health: rolling back"
echo "$version" > "$STATE/failed"
if [ -d "$APP.prev" ]; then
  rm -rf "$APP.failed"; mv "$APP" "$APP.failed"; mv "$APP.prev" "$APP"
  units_and_restart
  healthy && echo "previous version back up" || echo "previous version is not answering either"
fi
exit 1
