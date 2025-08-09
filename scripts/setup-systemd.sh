#!/usr/bin/env bash
set -euo pipefail
# Setup systemd service for LAN 3D Chess server
# Usage: sudo ./scripts/setup-systemd.sh /opt/lan-3d-chess 5174 node
# Args:
#  1) INSTALL_DIR absolute path (default: /opt/lan-3d-chess)
#  2) PORT (default: 5174)
#  3) NODE_BIN (default: /usr/bin/node)

INSTALL_DIR="${1:-/opt/lan-3d-chess}"
PORT="${2:-5174}"
NODE_BIN="${3:-/usr/bin/node}"
SERVICE_NAME="lan-3d-chess"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (sudo)." >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
chown -R ${SUDO_USER:-$(whoami)}:"${SUDO_USER:-$(whoami)}" "$INSTALL_DIR" || true

cat >"$INSTALL_DIR/.env" <<EOF
PORT=${PORT}
NODE_BIN=${NODE_BIN}
EOF

cat >"$SERVICE_FILE" <<EOF
[Unit]
Description=LAN 3D Chess server
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=${INSTALL_DIR}/.env
WorkingDirectory=${INSTALL_DIR}
ExecStart=${NODE_BIN} ${INSTALL_DIR}/server.mjs
Restart=always
RestartSec=3
# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}
SystemCtlOutput=$(systemctl start ${SERVICE_NAME} || true)

echo "Installed systemd service at ${SERVICE_FILE}"
echo "Service status:"
systemctl --no-pager -l status ${SERVICE_NAME} || true
