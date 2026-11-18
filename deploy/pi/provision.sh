#!/usr/bin/env bash
# One-time (and safe to repeat) setup of the Pi: the ehub user, folders, Node 22, kepubify, yt-dlp.
# Usage: deploy/pi/provision.sh user@host   — runs the block below over ssh with sudo. Nothing is installed with pnpm.
set -euo pipefail
# Extra ssh options, e.g. SSH_OPTS="-i ~/.ssh/id_ed25519_py".
SSH_OPTS="${SSH_OPTS:-}"
TARGET="${1:?usage: provision.sh user@host}"
ssh $SSH_OPTS "$TARGET" 'bash -s' <<'REMOTE'
set -euo pipefail
sudo id ehub >/dev/null 2>&1 || sudo useradd -r -m -s /usr/sbin/nologin ehub
sudo install -d -o ehub /var/lib/ehub/data/library /var/lib/ehub/data/explore /var/lib/ehub/data/notes /var/lib/ehub/data/podcasts /var/cache/ehub
sudo install -d -m 755 /etc/ehub /opt/ehub

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "Installing Node 22 (official tarball, checksum verified)"
  tmp="$(mktemp -d)"; cd "$tmp"
  base=https://nodejs.org/dist/latest-v22.x
  curl -fsSLO "$base/SHASUMS256.txt"
  file="$(grep -o 'node-v[0-9.]*-linux-arm64\.tar\.xz' SHASUMS256.txt | head -1)"
  curl -fsSLO "$base/$file"
  grep " $file\$" SHASUMS256.txt | sha256sum -c -
  sudo tar -xJf "$file" -C /usr/local --strip-components=1
  sudo ln -sf /usr/local/bin/node /usr/bin/node
  cd /; rm -rf "$tmp"
fi
node -v

if ! command -v kepubify >/dev/null; then
  echo "Installing kepubify (arm64, GitHub release)"
  sudo curl -fsSL -o /usr/local/bin/kepubify https://github.com/pgaskin/kepubify/releases/latest/download/kepubify-linux-arm64
  sudo chmod 755 /usr/local/bin/kepubify
fi
if ! command -v yt-dlp >/dev/null; then
  echo "Installing yt-dlp (aarch64 standalone, GitHub release)"
  sudo curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64
  sudo chmod 755 /usr/local/bin/yt-dlp
fi
command -v ffmpeg >/dev/null || sudo apt-get install -y ffmpeg
command -v rsync >/dev/null || sudo apt-get install -y rsync
kepubify --version | head -1; yt-dlp --version; ffmpeg -version | head -1
REMOTE
