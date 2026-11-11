import { contextBridge, ipcRenderer } from "electron";

// Plan.md lists the window bridge. playbackEnded and setVoice are the two
// additions Design.md needs: the renderer reports when a WAV finishes, and
// the expanded panel can change the TTS voice.
contextBridge.exposeInMainWorld("surf", {
  getState: () => ipcRenderer.invoke("get-state"),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("state", listener);
    return () => ipcRenderer.removeListener("state", listener);
  },
  submitSetup: (payload) => ipcRenderer.invoke("submit-setup", payload),
  setMuted: (muted) => ipcRenderer.invoke("set-muted", muted),
  setExpanded: (expanded) => ipcRenderer.invoke("set-expanded", expanded),
  stop: () => ipcRenderer.invoke("stop"),
  confirm: (yes) => ipcRenderer.invoke("confirm", yes),
  rename: (name) => ipcRenderer.invoke("rename", name),
  setVoice: (voiceId) => ipcRenderer.invoke("set-voice", voiceId),
  playbackEnded: (id) => ipcRenderer.invoke("playback-ended", id),
  pairBrowser: () => ipcRenderer.invoke("pair-browser"),
  disconnectBrowser: () => ipcRenderer.invoke("disconnect-browser"),
  quit: () => ipcRenderer.invoke("quit"),
});
