#!/usr/bin/env bash
# Writes /etc/ehub/env on the Pi from the repo's .env.local (the keys it knows about) plus the Pi-only settings.
# Usage: deploy/pi/push-env.sh user@host https://<pages-origin> [path/to/extra.env]
# Values are never printed; the file is root-owned, mode 600, and read by systemd. Needs a working ssh + sudo on the Pi.
set -euo pipefail
# Extra ssh options, e.g. SSH_OPTS="-i ~/.ssh/id_ed25519_py".
SSH_OPTS="${SSH_OPTS:-}"
TARGET="${1:?usage: push-env.sh user@host pages-origin [extra.env]}"
ORIGIN="${2:?usage: push-env.sh user@host pages-origin [extra.env]}"
EXTRA="${3:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
set -a; . "$ROOT/.env.local"; [ -n "$EXTRA" ] && . "$EXTRA"; set +a
KEYS="TURSO_DATABASE_URL TURSO_AUTH_TOKEN GOOGLE_CLIENT_ID SESSION_SECRET ALLOWED_EMAILS KOBO_OWNER_EMAIL R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET GROQ_API_KEY EHUB_AI_API_KEY EHUB_AI_MODEL"
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT; chmod 600 "$tmp"
{
  echo "PORT=8788"; echo "HOST=127.0.0.1"; echo "CORS_ORIGINS=$ORIGIN"
  echo "EHUB_DATA_ROOT=/var/lib/ehub/data"; echo "ELIB_CONFIG=/opt/ehub/elib.config.json"; echo "ELIB_CACHE_DIR=/var/cache/ehub/e-library"
  echo "EHUB_AI_BASE_URL=http://127.0.0.1:4100/v1"; echo "ELIB_KOBO_QUEUE=1"
  for k in $KEYS; do [ -n "${!k:-}" ] && echo "$k=${!k}" || echo "missing: $k" >&2; done
} > "$tmp"
echo "Keys written: $(cut -d= -f1 "$tmp" | grep -v '^$' | tr '\n' ' ')" >&2
scp $SSH_OPTS -q "$tmp" "$TARGET:/tmp/ehub-env.new"
ssh $SSH_OPTS "$TARGET" 'sudo install -m 600 -o root -g root /tmp/ehub-env.new /etc/ehub/env && rm -f /tmp/ehub-env.new'
