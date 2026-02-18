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

/* ── Create a new tab ── */
function createTab() {
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
  };

  ws.addEventListener("open", () => {
    ws.send(
      JSON.stringify({
        type: "spawn",
        cols: term.cols,
        rows: term.rows,
      })
    );
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
        tabEl.querySelector(".label").textContent = `Claude ${id} (pid ${msg.pid})`;
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
document.addEventListener("keydown", (e) => {
  // Ctrl+T — new tab
  if (e.ctrlKey && e.key === "t") {
    e.preventDefault();
    createTab();
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
newTabBtn.addEventListener("click", () => createTab());

/* ── Boot ── */
showEmptyState();
