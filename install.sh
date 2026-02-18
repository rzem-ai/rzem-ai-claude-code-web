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

# ── Resolve Node.js (may be hidden from sudo's PATH) ──
resolve_bin() {
  local bin_name="$1"
  # Already in PATH?
  local found
  found=$(command -v "$bin_name" 2>/dev/null) && { echo "$found"; return; }

  # Check the invoking user's PATH (sudo strips it)
  if [[ -n "${SUDO_USER:-}" ]]; then
    found=$(su - "$SUDO_USER" -c "command -v $bin_name" 2>/dev/null) && { echo "$found"; return; }
  fi

  # Common install locations (nvm, fnm, volta, system)
  local home_dir
  home_dir=$(eval echo "~${SUDO_USER:-$USER}")
  local candidates=(
    "$home_dir/.nvm/current/bin/$bin_name"
    "$home_dir/.local/share/fnm/aliases/default/bin/$bin_name"
    "$home_dir/.volta/bin/$bin_name"
    "/usr/local/bin/$bin_name"
    "/usr/bin/$bin_name"
  )
  # Also check any nvm version directories
  for dir in "$home_dir"/.nvm/versions/node/*/bin; do
    [[ -d "$dir" ]] && candidates+=("$dir/$bin_name")
  done

  for candidate in "${candidates[@]}"; do
    [[ -x "$candidate" ]] && { echo "$candidate"; return; }
  done

  return 1
}

NODE_BIN=$(resolve_bin node) || {
  echo "Error: Node.js is not installed. Please install Node.js >= 18."
  exit 1
}
NPM_BIN=$(resolve_bin npm) || {
  echo "Error: npm not found alongside Node.js at ${NODE_BIN}."
  exit 1
}

NODE_VERSION=$("$NODE_BIN" -v)
NODE_MAJOR=${NODE_VERSION#v}
NODE_MAJOR=${NODE_MAJOR%%.*}
if (( NODE_MAJOR < 18 )); then
  echo "Error: Node.js >= 18 required (found ${NODE_VERSION})."
  exit 1
fi

echo "Using Node.js ${NODE_VERSION} at ${NODE_BIN}"

CLAUDE_BIN=$(resolve_bin claude) && {
  echo "Using claude at ${CLAUDE_BIN}"
} || {
  echo "Warning: 'claude' command not found in PATH or common locations."
  echo "Make sure Claude Code CLI is installed and accessible by the service user."
}

# ── Install ──
echo "Installing to ${INSTALL_DIR}..."
mkdir -p "$INSTALL_DIR"
cp -r server.js package.json public/ "$INSTALL_DIR/"

echo "Installing dependencies..."
cd "$INSTALL_DIR"
"$NPM_BIN" install --omit=dev --ignore-scripts 2>/dev/null
# node-pty needs native compilation
"$NPM_BIN" rebuild node-pty 2>/dev/null

chown -R "$CURRENT_USER:$CURRENT_USER" "$INSTALL_DIR"

# ── Systemd service ──
echo "Installing systemd service..."
sed -e "s/YOUR_USER/$CURRENT_USER/g" \
    -e "s|/usr/bin/node|${NODE_BIN}|g" \
    "$(dirname "$0")/claude-code-web.service" \
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
