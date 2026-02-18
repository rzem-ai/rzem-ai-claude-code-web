/* ── State ── */
const tabs = new Map(); // id -> { term, fitAddon, ws, element, wrapper, alive }
let activeTabId = null;
let tabCounter = 0;

const tabsContainer = document.getElementById("tabs");
const terminalContainer = document.getElementById("terminal-container");
const newTabBtn = document.getElementById("new-tab-btn");

/* ── WebSocket URL ── */
function wsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}`;
}

/* ── localStorage Utilities ── */
const RECENT_DIRS_KEY = "claude-code-recent-dirs";
const RECENT_DIRS_MAX = 10;
const HOME_DIR = "/Users/alex"; // TODO: Could detect dynamically if needed

function getHomeDirectory() {
  return HOME_DIR;
}

function loadRecentDirectories() {
  try {
    const data = localStorage.getItem(RECENT_DIRS_KEY);
    if (!data) return [];

    const parsed = JSON.parse(data);
    if (!parsed.version || !Array.isArray(parsed.directories)) {
      return [];
    }

    return parsed.directories;
  } catch (error) {
    console.warn("Failed to load recent directories:", error);
    return [];
  }
}

function saveRecentDirectory(path) {
  try {
    const directories = loadRecentDirectories();
    const now = Date.now();

    // Check if path already exists
    const existingIndex = directories.findIndex(d => d.path === path);

    if (existingIndex >= 0) {
      // Update existing entry
      directories[existingIndex].lastUsed = now;
      directories[existingIndex].useCount = (directories[existingIndex].useCount || 1) + 1;
    } else {
      // Add new entry
      directories.unshift({
        path,
        displayName: formatDisplayPath(path),
        lastUsed: now,
        useCount: 1
      });
    }

    // Sort by lastUsed descending and keep top 10
    directories.sort((a, b) => b.lastUsed - a.lastUsed);
    const trimmed = directories.slice(0, RECENT_DIRS_MAX);

    localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify({
      version: 1,
      directories: trimmed
    }));
  } catch (error) {
    console.warn("Failed to save recent directory:", error);
  }
}

function formatDisplayPath(path) {
  if (path.startsWith(HOME_DIR)) {
    return "~" + path.substring(HOME_DIR.length);
  }
  return path;
}

function expandTildePath(path) {
  if (path.startsWith("~")) {
    return HOME_DIR + path.substring(1);
  }
  return path;
}

function formatRelativeTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) {
    return "Just now";
  } else if (diff < hour) {
    const minutes = Math.floor(diff / minute);
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  } else if (diff < day) {
    const hours = Math.floor(diff / hour);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  } else if (diff < 2 * day) {
    return "Yesterday";
  } else if (diff < 7 * day) {
    const days = Math.floor(diff / day);
    return `${days} days ago`;
  } else {
    return new Date(timestamp).toLocaleDateString();
  }
}

/* ── Directory Modal ── */
function createDirectoryModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const modal = document.createElement("div");
  modal.className = "modal-content";

  const header = document.createElement("div");
  header.className = "modal-header";
  header.textContent = "Start New Claude Instance";

  const body = document.createElement("div");
  body.className = "modal-body";

  const input = document.createElement("input");
  input.type = "text";
  input.id = "dir-input";
  input.className = "dir-input";
  input.placeholder = "Enter directory path (e.g., ~/Dev/project)";
  input.autocomplete = "off";

  const recentLabel = document.createElement("div");
  recentLabel.className = "recent-dirs-label";
  recentLabel.textContent = "Recent Directories";

  const recentDirs = document.createElement("div");
  recentDirs.id = "recent-dirs";
  recentDirs.className = "recent-dirs";

  body.appendChild(input);
  body.appendChild(recentLabel);
  body.appendChild(recentDirs);

  const buttons = document.createElement("div");
  buttons.className = "modal-buttons";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "modal-btn modal-btn-secondary";
  cancelBtn.id = "modal-cancel";
  cancelBtn.textContent = "Cancel";

  const homeBtn = document.createElement("button");
  homeBtn.className = "modal-btn modal-btn-secondary";
  homeBtn.id = "modal-home";
  homeBtn.textContent = "Start in Home";

  const startBtn = document.createElement("button");
  startBtn.className = "modal-btn modal-btn-primary";
  startBtn.id = "modal-start";
  startBtn.textContent = "Start";

  buttons.appendChild(cancelBtn);
  buttons.appendChild(homeBtn);
  buttons.appendChild(startBtn);

  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(buttons);

  overlay.appendChild(modal);
  return overlay;
}

function populateRecentDirectories(container) {
  const directories = loadRecentDirectories();

  container.innerHTML = "";

  if (directories.length === 0) {
    const empty = document.createElement("div");
    empty.className = "recent-dirs-empty";
    empty.textContent = "No recent directories yet";
    container.appendChild(empty);
    return;
  }

  directories.forEach(dir => {
    const card = document.createElement("div");
    card.className = "recent-dir-card";

    const icon = document.createElement("div");
    icon.className = "recent-dir-icon";
    icon.textContent = "📁";

    const info = document.createElement("div");
    info.className = "recent-dir-info";

    const path = document.createElement("div");
    path.className = "recent-dir-path";
    path.textContent = dir.displayName; // Safe: use textContent for user data

    const time = document.createElement("div");
    time.className = "recent-dir-time";
    time.textContent = formatRelativeTime(dir.lastUsed);

    info.appendChild(path);
    info.appendChild(time);

    card.appendChild(icon);
    card.appendChild(info);

    card.addEventListener("click", () => {
      const input = document.getElementById("dir-input");
      input.value = dir.displayName;
      input.focus();
      document.getElementById("modal-start").focus();
    });

    container.appendChild(card);
  });
}

function showDirectoryModal() {
  return new Promise((resolve) => {
    const overlay = createDirectoryModal();
    document.body.appendChild(overlay);

    const input = document.getElementById("dir-input");
    const recentDirs = document.getElementById("recent-dirs");
    const cancelBtn = document.getElementById("modal-cancel");
    const homeBtn = document.getElementById("modal-home");
    const startBtn = document.getElementById("modal-start");

    // Populate recent directories
    populateRecentDirectories(recentDirs);

    // Focus input
    requestAnimationFrame(() => input.focus());

    // Cleanup function
    const cleanup = () => {
      overlay.remove();
    };

    // Cancel handler
    const handleCancel = () => {
      cleanup();
      resolve(null);
    };

    // Start handler
    const handleStart = () => {
      let path = input.value.trim();

      if (!path) {
        // Empty input = use home directory
        cleanup();
        resolve(null);
        return;
      }

      // Expand tilde paths
      path = expandTildePath(path);

      cleanup();
      resolve(path);
    };

    // Home handler
    const handleHome = () => {
      cleanup();
      resolve(null);
    };

    // Event listeners
    cancelBtn.addEventListener("click", handleCancel);
    homeBtn.addEventListener("click", handleHome);
    startBtn.addEventListener("click", handleStart);

    // Enter key in input
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleStart();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    });

    // Escape key globally
    const escapeHandler = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
        document.removeEventListener("keydown", escapeHandler);
      }
    };
    document.addEventListener("keydown", escapeHandler);

    // Click outside to close
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        handleCancel();
      }
    });
  });
}

/* ── Create a new tab ── */
function createTab(cwd = null) {
  const id = ++tabCounter;
  const label = `Claude ${id}`;

  // Tab element
  const tabEl = document.createElement("div");
  tabEl.className = "tab";
  tabEl.dataset.id = id;
  tabEl.innerHTML = `
    <span class="status-dot"></span>
    <span class="label">${label}</span>
    <button class="close-btn" title="Close (Ctrl+W)">&times;</button>
  `;
  tabsContainer.appendChild(tabEl);

  // Terminal wrapper
  const wrapper = document.createElement("div");
  wrapper.className = "terminal-wrapper";
  wrapper.dataset.id = id;
  terminalContainer.appendChild(wrapper);

  // xterm.js instance
  const term = new Terminal({
    cursorBlink: true,
    cursorStyle: "bar",
    fontSize: 14,
    fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "SF Mono", Menlo, Monaco, "Courier New", monospace',
    theme: {
      background: "#1a1b26",
      foreground: "#c0caf5",
      cursor: "#c0caf5",
      cursorAccent: "#1a1b26",
      selectionBackground: "#33467c",
      black: "#15161e",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    },
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);

  const webLinksAddon = new WebLinksAddon.WebLinksAddon();
  term.loadAddon(webLinksAddon);

  term.open(wrapper);
  fitAddon.fit();

  // WebSocket connection
  const ws = new WebSocket(wsUrl());

  const tabState = {
    id,
    term,
    fitAddon,
    ws,
    element: tabEl,
    wrapper,
    alive: true,
    cwd: cwd || null,
  };

  ws.addEventListener("open", () => {
    const spawnMsg = {
      type: "spawn",
      cols: term.cols,
      rows: term.rows,
    };

    // Include cwd if specified
    if (cwd) {
      spawnMsg.cwd = cwd;
    }

    ws.send(JSON.stringify(spawnMsg));
  });

  ws.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    switch (msg.type) {
      case "output":
        term.write(msg.data);
        break;

      case "spawned":
        // Update tab label with directory if not home
        let label = `Claude ${id} (pid ${msg.pid})`;
        if (tabState.cwd && tabState.cwd !== getHomeDirectory()) {
          const dirName = tabState.cwd.split("/").pop();
          label = `Claude ${id} - ${dirName}`;
          // Save to recent directories
          saveRecentDirectory(tabState.cwd);
        }
        tabEl.querySelector(".label").textContent = label;
        break;

      case "exit":
        tabState.alive = false;
        tabEl.querySelector(".status-dot").classList.add("exited");
        tabEl.querySelector(".label").textContent = `Claude ${id} [exited: ${msg.exitCode}]`;
        term.write(`\r\n\x1b[90m— process exited with code ${msg.exitCode} —\x1b[0m\r\n`);
        break;

      case "error":
        term.write(`\r\n\x1b[31mError: ${msg.message}\x1b[0m\r\n`);
        tabState.alive = false;
        tabEl.querySelector(".status-dot").classList.add("exited");
        break;
    }
  });

  ws.addEventListener("close", () => {
    if (tabState.alive) {
      tabState.alive = false;
      tabEl.querySelector(".status-dot").classList.add("exited");
      term.write("\r\n\x1b[90m— connection lost —\x1b[0m\r\n");
    }
  });

  // Terminal → server
  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data }));
    }
  });

  // Resize
  term.onResize(({ cols, rows }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  });

  // Tab click handlers
  tabEl.addEventListener("click", (e) => {
    if (e.target.classList.contains("close-btn")) {
      closeTab(id);
    } else {
      activateTab(id);
    }
  });

  tabs.set(id, tabState);
  activateTab(id);
  removeEmptyState();

  return id;
}

/* ── Activate a tab ── */
function activateTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;

  // Deactivate current
  if (activeTabId !== null) {
    const prev = tabs.get(activeTabId);
    if (prev) {
      prev.element.classList.remove("active");
      prev.wrapper.classList.remove("active");
    }
  }

  activeTabId = id;
  tab.element.classList.add("active");
  tab.wrapper.classList.add("active");

  // Ensure terminal is properly sized
  requestAnimationFrame(() => {
    tab.fitAddon.fit();
    tab.term.focus();
  });

  // Scroll tab into view
  tab.element.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
}

/* ── Close a tab ── */
function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;

  // Kill the process
  if (tab.alive && tab.ws.readyState === WebSocket.OPEN) {
    tab.ws.send(JSON.stringify({ type: "kill" }));
  }
  tab.ws.close();
  tab.term.dispose();
  tab.element.remove();
  tab.wrapper.remove();
  tabs.delete(id);

  // Activate a neighboring tab
  if (activeTabId === id) {
    activeTabId = null;
    const remaining = [...tabs.keys()];
    if (remaining.length > 0) {
      activateTab(remaining[remaining.length - 1]);
    } else {
      showEmptyState();
    }
  }
}

/* ── Empty state ── */
function showEmptyState() {
  if (document.querySelector(".empty-state")) return;
  const el = document.createElement("div");
  el.className = "empty-state";
  el.innerHTML = `
    <div class="logo">&gt;_</div>
    <p>No active sessions</p>
    <p>Press <kbd>Ctrl+T</kbd> or click <kbd>+</kbd> to start a new Claude Code instance</p>
  `;
  terminalContainer.appendChild(el);
}

function removeEmptyState() {
  const el = document.querySelector(".empty-state");
  if (el) el.remove();
}

/* ── Resize handling ── */
window.addEventListener("resize", () => {
  if (activeTabId !== null) {
    const tab = tabs.get(activeTabId);
    if (tab) {
      tab.fitAddon.fit();
    }
  }
});

/* ── Keyboard shortcuts ── */
document.addEventListener("keydown", async (e) => {
  // Ctrl+T — new tab
  if (e.ctrlKey && e.key === "t") {
    e.preventDefault();
    const selectedDir = await showDirectoryModal();
    createTab(selectedDir);
    return;
  }

  // Ctrl+W — close current tab
  if (e.ctrlKey && e.key === "w") {
    e.preventDefault();
    if (activeTabId !== null) {
      closeTab(activeTabId);
    }
    return;
  }

  // Ctrl+Tab / Ctrl+Shift+Tab — cycle tabs
  if (e.ctrlKey && e.key === "Tab") {
    e.preventDefault();
    const ids = [...tabs.keys()];
    if (ids.length < 2) return;
    const idx = ids.indexOf(activeTabId);
    const next = e.shiftKey
      ? (idx - 1 + ids.length) % ids.length
      : (idx + 1) % ids.length;
    activateTab(ids[next]);
    return;
  }

  // Ctrl+1-9 — jump to tab by index
  if (e.ctrlKey && e.key >= "1" && e.key <= "9") {
    e.preventDefault();
    const ids = [...tabs.keys()];
    const idx = parseInt(e.key) - 1;
    if (idx < ids.length) {
      activateTab(ids[idx]);
    }
    return;
  }
});

/* ── New tab button ── */
newTabBtn.addEventListener("click", async () => {
  const selectedDir = await showDirectoryModal();
  createTab(selectedDir);
});

/* ── Boot ── */
showEmptyState();
