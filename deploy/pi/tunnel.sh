#!/usr/bin/env bash
# Adds a hostname for the API to the Pi's existing Cloudflare tunnel (ingress rule + DNS record) and restarts cloudflared.
# Usage: deploy/pi/tunnel.sh user@host api.example.com [tunnel-name]
# The rule is inserted before the catch-all; the previous config is kept as config.yml.bak. Idempotent.
set -euo pipefail
# Extra ssh options, e.g. SSH_OPTS="-i ~/.ssh/id_ed25519_py".
SSH_OPTS="${SSH_OPTS:-}"
TARGET="${1:?usage: tunnel.sh user@host hostname [tunnel]}"; HOST="${2:?hostname}"; TUNNEL="${3:-freeway}"
ssh $SSH_OPTS "$TARGET" "HOST='$HOST' TUNNEL='$TUNNEL' bash -s" <<'REMOTE'
set -euo pipefail
CFG=/etc/cloudflared/config.yml
if sudo grep -q "hostname: $HOST" "$CFG"; then echo "ingress for $HOST already there"; else
  sudo cp "$CFG" "$CFG.bak"
  sudo python3 - "$CFG" "$HOST" <<'PY'
import sys
path, host = sys.argv[1], sys.argv[2]
lines = open(path).read().split("\n")
i = max(n for n, l in enumerate(lines) if l.strip().startswith("- service:"))
lines[i:i] = [f"  - hostname: {host}", "    service: http://127.0.0.1:8788"]
open(path, "w").write("\n".join(lines))
PY
  cloudflared tunnel --config "$CFG" ingress validate
  sudo systemctl restart cloudflared
fi
cloudflared tunnel route dns "$TUNNEL" "$HOST" || true
REMOTE
