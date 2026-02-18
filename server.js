const express = require("express");
const http = require("http");
const path = require("path");
const { execSync } = require("child_process");
const { WebSocketServer } = require("ws");
const pty = require("node-pty");
const os = require("os");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const DEFAULT_CWD = process.env.DEFAULT_CWD || os.homedir();

// Resolve the absolute path to the claude binary so node-pty can always find it.
// Falls back to common locations if `which` fails (e.g. minimal PATH in systemd).
function resolveClaude() {
  if (process.env.CLAUDE_CMD) return process.env.CLAUDE_CMD;

  // Try resolving from current shell
  try {
    return execSync("which claude", { encoding: "utf8" }).trim();
  } catch {
    // Ignore
  }

  // Common install locations
  const candidates = [
    path.join(os.homedir(), ".npm-global", "bin", "claude"),
    "/usr/local/bin/claude",
    "/usr/bin/claude",
    "/opt/node22/bin/claude",
    path.join(os.homedir(), ".local", "bin", "claude"),
  ];
  const fs = require("fs");
  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      // not here
    }
  }

  // Last resort — let the spawn fail with a clear message
  return "claude";
}

const CLAUDE_CMD = resolveClaude();
console.log(`Using claude binary: ${CLAUDE_CMD}`);

// Track active sessions for cleanup
const sessions = new Map();

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

wss.on("connection", (ws) => {
  let ptyProcess = null;
  let sessionId = null;

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      // Raw input fallback — treat as terminal input
      if (ptyProcess) ptyProcess.write(data.toString());
      return;
    }

    switch (msg.type) {
      case "spawn": {
        // Spawn a new Claude Code PTY
        const cwd = msg.cwd || DEFAULT_CWD;
        const cols = msg.cols || 120;
        const rows = msg.rows || 30;

        const shell = CLAUDE_CMD;
        const args = [];

        // Build an environment with a PATH that includes the directory
        // where claude lives, so child processes resolve correctly too.
        const claudeDir = path.dirname(CLAUDE_CMD);
        const envPath = process.env.PATH || "";
        const fullPath = envPath.includes(claudeDir)
          ? envPath
          : `${claudeDir}:${envPath}`;

        try {
          ptyProcess = pty.spawn(shell, args, {
            name: "xterm-256color",
            cols,
            rows,
            cwd,
            env: {
              ...process.env,
              PATH: fullPath,
              TERM: "xterm-256color",
              COLORTERM: "truecolor",
            },
          });
        } catch (err) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: `Failed to spawn claude: ${err.message}`,
            })
          );
          return;
        }

        sessionId = ptyProcess.pid.toString();
        sessions.set(sessionId, ptyProcess);

        ws.send(JSON.stringify({ type: "spawned", pid: ptyProcess.pid }));

        ptyProcess.onData((data) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "output", data }));
          }
        });

        ptyProcess.onExit(({ exitCode }) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "exit", exitCode }));
          }
          sessions.delete(sessionId);
          ptyProcess = null;
        });

        break;
      }

      case "input": {
        if (ptyProcess) {
          ptyProcess.write(msg.data);
        }
        break;
      }

      case "resize": {
        if (ptyProcess && msg.cols && msg.rows) {
          try {
            ptyProcess.resize(msg.cols, msg.rows);
          } catch {
            // Ignore resize errors on dead processes
          }
        }
        break;
      }

      case "kill": {
        if (ptyProcess) {
          ptyProcess.kill();
        }
        break;
      }
    }
  });

  ws.on("close", () => {
    if (ptyProcess) {
      try {
        ptyProcess.kill();
      } catch {
        // Already dead
      }
      sessions.delete(sessionId);
    }
  });
});

// Cleanup on shutdown
function cleanup() {
  for (const [id, proc] of sessions) {
    try {
      proc.kill();
    } catch {
      // ignore
    }
  }
  sessions.clear();
  server.close();
  process.exit(0);
}

process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);

server.listen(PORT, () => {
  console.log(`Claude Code Web running at http://localhost:${PORT}`);
});
