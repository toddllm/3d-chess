#!/usr/bin/env bash
set -euo pipefail
# Deploy built assets and server to a target directory
# Usage: ./scripts/deploy.sh user@server:/opt/lan-3d-chess
TARGET=${1:-}
if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 user@server:/opt/lan-3d-chess" >&2
  exit 1
fi

HERE=$(cd "$(dirname "$0")/.." && pwd)
(cd "$HERE" && npm run build)

rsync -av --delete \
  "$HERE/dist/" "$TARGET/dist/"
rsync -av "$HERE/server.js" "$TARGET/server.mjs"
rsync -av "$HERE/additions/" "$TARGET/additions/" || true

ssh "${TARGET%%:*}" "sudo /bin/bash -s" <<'EOS'
set -e
systemctl restart lan-3d-chess || true
EOS

echo "Deploy complete to $TARGET"
