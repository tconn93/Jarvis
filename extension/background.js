const PORTS = [47321, 47322, 47323, 47324, 47325, 47326, 47327, 47328, 47329, 47330];

let socket = null;
let ping = null;

function send(message) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

async function setConnected(connected) {
  await chrome.storage.local.set({ connected });
}

async function runTab(tool, args) {
  if (tool === "browser_open_window") {
    const created = await chrome.windows.create({ url: args.url || "about:blank", focused: true });
    return { windowId: created.id, url: args.url || "about:blank" };
  }
  if (tool === "browser_open_tab") {
    const created = await chrome.tabs.create({ url: args.url || "about:blank", active: true });
    return { tabId: created.id, url: created.url || args.url || "about:blank" };
  }
  if (tool === "browser_focus") {
    let windowId = args.windowId;
    let tabId = args.tabId;
    if (!tabId && args.title) {
      const tabs = await chrome.tabs.query({});
      const want = String(args.title).toLowerCase();
      const tab = tabs.find((item) => (item.title || "").toLowerCase().includes(want));
      if (!tab) throw new Error("No matching tab.");
      tabId = tab.id;
      windowId = windowId || tab.windowId;
    }
    if (windowId) await chrome.windows.update(windowId, { focused: true });
    if (tabId) await chrome.tabs.update(tabId, { active: true });
    if (!windowId && !tabId) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) await chrome.tabs.update(tab.id, { active: true });
    }
    return { ok: true };
  }
  if (tool === "browser_navigate") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No tab is open.");
    await chrome.tabs.update(tab.id, { url: args.url });
    return { tabId: tab.id, url: args.url };
  }
  throw new Error(`Unknown browser tool ${tool}`);
}

async function runPage(tool, args) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No tab is open.");
  const response = await chrome.tabs.sendMessage(tab.id, { type: "call", tool, args });
  if (!response) throw new Error("The page did not answer.");
  if (response.ok === false) throw new Error(response.error || "The page did not do that.");
  return response.data ?? {};
}

const TAB_TOOLS = new Set([
  "browser_open_window",
  "browser_open_tab",
  "browser_focus",
  "browser_navigate",
]);

async function handleCall(message) {
  try {
    const data = TAB_TOOLS.has(message.tool)
      ? await runTab(message.tool, message.args || {})
      : await runPage(message.tool, message.args || {});
    send({ id: message.id, type: "result", ok: true, data });
  } catch (error) {
    send({ id: message.id, type: "result", ok: false, error: error.message });
  }
}

function connect(port, token) {
  if (socket) socket.close();
  socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  socket.addEventListener("open", () => {
    send({ type: "auth", token });
    setConnected(true);
    clearInterval(ping);
    ping = setInterval(() => send({ type: "ping" }), 20000);
  });
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "call") handleCall(message);
  });
  socket.addEventListener("close", () => {
    clearInterval(ping);
    setConnected(false);
  });
}

async function pair(code) {
  for (const port of PORTS) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) continue;
      const body = await response.json();
      if (!body.token) continue;
      await chrome.storage.local.set({ token: body.token, port });
      connect(port, body.token);
      return { ok: true };
    } catch {
      /* try the next port */
    }
  }
  return { ok: false, error: "Surf is not running." };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "pair") return false;
  pair(message.code).then(sendResponse);
  return true;
});

chrome.storage.local.get(["token", "port"]).then((stored) => {
  if (stored.token && stored.port) connect(stored.port, stored.token);
});

chrome.tabs.onActivated.addListener(() => {
  if (socket && socket.readyState === WebSocket.OPEN) send({ type: "ping" });
});
