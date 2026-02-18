const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");
const pty = require("node-pty");
const os = require("os");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const CLAUDE_CMD = process.env.CLAUDE_CMD || "claude";
const DEFAULT_CWD = process.env.DEFAULT_CWD || os.homedir();

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

        try {
          ptyProcess = pty.spawn(shell, args, {
            name: "xterm-256color",
            cols,
            rows,
            cwd,
            env: {
              ...process.env,
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
