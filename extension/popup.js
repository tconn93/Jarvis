const state = document.getElementById("state");
const code = document.getElementById("code");

async function refresh() {
  const stored = await chrome.storage.local.get(["connected"]);
  state.textContent = stored.connected ? "Connected" : "Disconnected";
}

document.getElementById("pair").addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "pair", code: code.value.trim() });
  state.textContent = response?.ok ? "Connected" : response?.error || "Disconnected";
});

refresh();
