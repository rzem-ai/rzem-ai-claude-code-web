# Claude Code Web

Web-based tabbed interface for running local Claude Code CLI instances. Think zellij's web UI, but purpose-built for Claude Code.

## Project structure

```
server.js                 — Node.js backend (Express + WebSocket + node-pty)
public/
  index.html              — Single-page shell, loads xterm.js from CDN
  app.js                  — Frontend: tab management, terminal lifecycle, keyboard shortcuts
  style.css               — Tokyo Night theme, tab bar, terminal layout
claude-code-web.service   — systemd unit file (starts on boot)
install.sh                — Production installer (copies to /opt, enables service)
```

## How it works

- Each browser tab click spawns a real `claude` CLI process inside a pseudo-terminal (PTY) on the server via `node-pty`.
- Terminal I/O is streamed over a WebSocket connection using JSON messages (`spawn`, `input`, `output`, `resize`, `kill`, `exit`).
- The frontend renders each PTY in its own `xterm.js` Terminal instance behind a tabbed interface.
- The server resolves the `claude` binary path at startup (via `which`, then fallback candidate paths) so it works even under systemd's minimal PATH.

## Running locally

```bash
npm install
npm start           # http://localhost:3000
```

## Environment variables

| Variable      | Default         | Description                              |
|---------------|-----------------|------------------------------------------|
| `PORT`        | `3000`          | HTTP/WebSocket listen port               |
| `CLAUDE_CMD`  | auto-detected   | Absolute path to `claude` binary         |
| `DEFAULT_CWD` | `$HOME`         | Working directory for spawned instances   |

## Production install (systemd)

```bash
sudo ./install.sh
```

This copies the app to `/opt/claude-code-web`, installs dependencies, and enables a systemd service that starts on boot. See `install.sh` output for management commands.

## Key dependencies

- **express** — static file serving and HTTP server
- **ws** — WebSocket server for real-time terminal I/O
- **node-pty** — spawns Claude Code in a real PTY (supports 256-color, cursor positioning, etc.)
- **xterm.js** (CDN) — terminal emulator in the browser with fit and web-links addons

## Frontend keyboard shortcuts

| Shortcut              | Action                     |
|-----------------------|----------------------------|
| `Ctrl+T`             | New Claude Code tab        |
| `Ctrl+W`             | Close current tab          |
| `Ctrl+Tab`           | Next tab                   |
| `Ctrl+Shift+Tab`     | Previous tab               |
| `Ctrl+1` – `Ctrl+9`  | Jump to tab by position    |

## Development notes

- The frontend is vanilla JS with no build step. Edit files in `public/` and reload.
- xterm.js and addons are loaded from jsDelivr CDN — no bundler needed.
- The server has no authentication. If exposed beyond localhost, add a reverse proxy with auth.
- Each WebSocket connection maps to exactly one PTY process. Closing the WebSocket kills the PTY.
- All PTY processes are cleaned up on SIGTERM/SIGINT for graceful shutdown.
