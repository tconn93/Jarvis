const surf = window.surf;

const windowEl = document.getElementById("window");
const nameEl = document.getElementById("name");
const statusEl = document.getElementById("status");
const micEl = document.getElementById("mic");
const chevronEl = document.getElementById("chevron");
const setupEl = document.getElementById("setup");
const setupName = document.getElementById("setup-name");
const setupKey = document.getElementById("setup-key");
const setupError = document.getElementById("setup-error");
const panelEl = document.getElementById("panel");
const confirmEl = document.getElementById("confirm");
const confirmQ = document.getElementById("confirm-q");
const nowEl = document.getElementById("now");
const logEl = document.getElementById("log");
const stopEl = document.getElementById("stop");
const renameEl = document.getElementById("rename");
const voiceEl = document.getElementById("voice");
const browserState = document.getElementById("browser-state");
const pairCode = document.getElementById("pair-code");
const pairButton = document.getElementById("pair");
const player = document.getElementById("player");

let lastPlay = 0;

function fillList(list, items, empty) {
  list.replaceChildren();
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = empty;
    list.append(li);
    return;
  }
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    list.append(li);
  }
}

function render(state) {
  const setup = state.status === "needs setup";
  const expanded = Boolean(state.expanded) && !setup;
  windowEl.classList.toggle("is-setup", setup);
  windowEl.classList.toggle("is-expanded", expanded);
  nameEl.textContent = state.name || "Surf";
  statusEl.textContent = state.status || "listening";
  statusEl.dataset.hot = state.status === "listening" ? "1" : "0";
  micEl.dataset.on = state.muted ? "0" : "1";
  micEl.setAttribute("aria-label", state.muted ? "Unmute microphone" : "Mute microphone");
  micEl.disabled = setup;
  chevronEl.disabled = setup;
  chevronEl.setAttribute("aria-expanded", expanded ? "true" : "false");
  chevronEl.setAttribute("aria-label", expanded ? "Collapse" : "Expand");
  setupEl.hidden = !setup;
  panelEl.hidden = !expanded;
  if (state.confirm?.question) {
    confirmEl.hidden = false;
    confirmQ.textContent = state.confirm.question;
  } else {
    confirmEl.hidden = true;
  }
  fillList(nowEl, state.now || [], "Nothing running.");
  fillList(
    logEl,
    (state.log || []).map((line) => `${line.kind}  ${line.text}`),
    "No commands yet.",
  );
  if (document.activeElement !== renameEl) renameEl.value = state.name || "";
  if (document.activeElement !== voiceEl) voiceEl.value = state.voiceId || "eve";
  setupError.textContent = state.error || "";
  stopEl.disabled = state.status !== "working" && state.status !== "waiting for yes";
  const browser = state.browser || { connected: false, code: "" };
  browserState.textContent = browser.connected ? "Browser connected" : "Browser disconnected";
  if (browser.code) {
    pairCode.hidden = false;
    pairCode.textContent = browser.code;
  } else {
    pairCode.hidden = true;
    pairCode.textContent = "";
  }
  pairButton.textContent = browser.connected ? "Disconnect browser" : "Pair browser";

  if (state.play && state.play.id !== lastPlay) {
    lastPlay = state.play.id;
    player.src = `data:audio/wav;base64,${state.play.wavBase64}`;
    player.onended = () => surf.playbackEnded?.(state.play.id);
    player.play().catch(() => surf.playbackEnded?.(state.play.id));
  }

  if (document.body.classList.contains("demo")) {
    parent.postMessage({ type: "surf-size", height: windowEl.offsetHeight }, "*");
  }
}

micEl.addEventListener("click", () => {
  const muted = micEl.dataset.on === "1";
  surf.setMuted(muted);
});

chevronEl.addEventListener("click", () => {
  const expanded = chevronEl.getAttribute("aria-expanded") !== "true";
  surf.setExpanded(expanded);
});

setupEl.addEventListener("submit", (event) => {
  event.preventDefault();
  surf.submitSetup({ name: setupName.value, apiKey: setupKey.value });
});

document.getElementById("yes").addEventListener("click", () => surf.confirm(true));
document.getElementById("no").addEventListener("click", () => surf.confirm(false));
stopEl.addEventListener("click", () => surf.stop());

document.getElementById("rename-form").addEventListener("submit", (event) => {
  event.preventDefault();
  surf.rename(renameEl.value);
  surf.setVoice?.(voiceEl.value);
});

pairButton.addEventListener("click", () => {
  const connected = browserState.textContent === "Browser connected";
  if (connected) surf.disconnectBrowser?.();
  else surf.pairBrowser?.();
});

surf.onState(render);
surf.getState().then(render);
