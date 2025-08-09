#!/usr/bin/env bash
set -euo pipefail
# Backup current deployment on server (static files only)
# Usage: ./scripts/backup.sh user@server:/opt/lan-3d-chess /path/to/backup.tgz
TARGET=${1:-}
ARCHIVE=${2:-backup-$(date +%Y%m%d%H%M%S).tgz}
if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 user@server:/opt/lan-3d-chess [archive.tgz]" >&2
  exit 1
fi

REMOTE_HOST="${TARGET%%:*}"
REMOTE_DIR="${TARGET#*:}"

ssh "$REMOTE_HOST" "tar czf - -C '$REMOTE_DIR' dist additions server.mjs 2>/dev/null || tar czf - -C '$REMOTE_DIR' dist server.mjs" > "$ARCHIVE"
echo "Saved backup to $ARCHIVE"