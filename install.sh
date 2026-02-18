#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/opt/claude-code-web"
SERVICE_NAME="claude-code-web"
CURRENT_USER="${SUDO_USER:-$USER}"

# ── Preflight ──
if [[ $EUID -ne 0 ]]; then
  echo "This script must be run as root (use sudo)."
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo "Error: Node.js is not installed. Please install Node.js >= 18."
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if (( NODE_MAJOR < 18 )); then
  echo "Error: Node.js >= 18 required (found $(node -v))."
  exit 1
fi

if ! command -v claude &>/dev/null; then
  echo "Warning: 'claude' command not found in PATH."
  echo "Make sure Claude Code CLI is installed and accessible by the service user."
fi

# ── Install ──
echo "Installing to ${INSTALL_DIR}..."
mkdir -p "$INSTALL_DIR"
cp -r server.js package.json public/ "$INSTALL_DIR/"

echo "Installing dependencies..."
cd "$INSTALL_DIR"
npm install --omit=dev --ignore-scripts 2>/dev/null
# node-pty needs native compilation
npm rebuild node-pty 2>/dev/null

chown -R "$CURRENT_USER:$CURRENT_USER" "$INSTALL_DIR"

# ── Systemd service ──
echo "Installing systemd service..."
sed "s/YOUR_USER/$CURRENT_USER/g" "$(dirname "$0")/claude-code-web.service" \
  > /etc/systemd/system/${SERVICE_NAME}.service

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl start "$SERVICE_NAME"

echo ""
echo "Done! Claude Code Web is running."
echo "  URL:     http://localhost:3000"
echo "  Status:  sudo systemctl status ${SERVICE_NAME}"
echo "  Logs:    sudo journalctl -u ${SERVICE_NAME} -f"
echo "  Stop:    sudo systemctl stop ${SERVICE_NAME}"
echo "  Remove:  sudo systemctl disable ${SERVICE_NAME} && sudo rm -rf ${INSTALL_DIR} /etc/systemd/system/${SERVICE_NAME}.service"
