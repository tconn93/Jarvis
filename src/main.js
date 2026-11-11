import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  safeStorage,
} from "electron";
import {
  createCapture,
  createClipStore,
  createListener,
  probeNativeAudio,
  startPvCapture,
} from "./audio.js";
import { runToolLoop } from "./agent.js";
import { askConfirmation, interpretAnswer } from "./confirm.js";
import { createMcpSession, createDesktop } from "./tools/desktop.js";
import { decide } from "./gate.js";
import { createLoop } from "./loop.js";
import { createLog } from "./log.js";
import { createSettingsStore } from "./settings.js";
import { speak } from "./speech.js";
import { buildGrammar, createVoskFeed, ensureVoskModel, readVoskWords } from "./wake.js";
import { transcribeFile } from "./stt.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const renderer = path.join(here, "..", "renderer", "index.html");

let win;
let tray;
let store;
let activity;
let loop;
let clips;
let settings = null;
let needsSetup = true;
let expanded = false;
let logLines = [];
let errorText = "";
let confirmQuestion = "";
let confirmResolve = null;
let queuedPlay = null;
let playWait = null;
let quitting = false;
let hostPath = "electron";
let muted = false;
let captureMode = "wake";
let heardConfirm = null;
let dictionary = null;
let voskFeed = null;
let capture = null;
let helper = null;

function surfDir() {
  return path.join(app.getPath("appData"), "Surf");
}

function publish() {
  const loopState = loop?.state();
  const play = queuedPlay;
  queuedPlay = null;
  const payload = {
    status: needsSetup ? "needs setup" : loopState?.status ?? (muted ? "muted" : "listening"),
    name: settings?.agentName ?? "",
    voiceId: settings?.voiceId ?? "eve",
    muted: loopState?.muted ?? muted,
    expanded,
    now: loopState?.now ?? [],
    log: logLines,
    confirm: confirmResolve ? { question: confirmQuestion } : null,
    error: errorText,
    play,
  };
  if (win && !win.isDestroyed()) win.webContents.send("state", payload);
  return payload;
}

function resize() {
  if (!win || win.isDestroyed()) return;
  const height = needsSetup ? 300 : expanded ? 440 : 72;
  const [width] = win.getSize();
  win.setSize(width || 320, height);
}

function trayImage() {
  const file = path.join(here, "..", "assets", muted ? "tray-muted.png" : "tray.png");
  const image = nativeImage.createFromPath(file);
  return image.isEmpty() ? nativeImage.createEmpty() : image;
}

function rebuildTray() {
  if (!tray) return;
  tray.setImage(trayImage());
  const menu = Menu.buildFromTemplate([
    { label: "Show", click: () => win?.show() },
    {
      label: muted ? "Unmute" : "Mute",
      click: () => setMuted(!muted),
    },
    { type: "separator" },
    { label: "Quit", click: () => quit() },
  ]);
  tray.setContextMenu(menu);
}

async function playLine(text) {
  const key = await store.readKey();
  const result = await speak({
    text,
    voiceId: settings?.voiceId || "eve",
    apiKey: key,
    play: (wav) =>
      new Promise((resolve) => {
        const id = Date.now();
        playWait = { id, resolve };
        queuedPlay = { id, wavBase64: Buffer.from(wav).toString("base64") };
        publish();
        setTimeout(() => {
          if (playWait?.id === id) {
            playWait = null;
            resolve();
          }
        }, 20000);
      }),
  });
  if (!result.ok) errorText = result.error;
  await new Promise((resolve) => setTimeout(resolve, 300));
  return result;
}

async function confirm(question) {
  confirmQuestion = question;
  captureMode = "confirm";
  voskFeed?.setGrammar(["yes", "no", "[unk]"]);
  const button = new Promise((resolve) => {
    confirmResolve = resolve;
  });
  const heard = new Promise((resolve) => {
    heardConfirm = resolve;
  });
  publish();
  const yes = await askConfirmation({
    question,
    speak: playLine,
    listen: () => heard,
    button: () => button,
    log: activity,
  });
  confirmResolve = null;
  confirmQuestion = "";
  captureMode = "wake";
  if (settings?.agentName) voskFeed?.setGrammar(buildGrammar(settings.agentName));
  publish();
  return yes;
}

async function ensureLoop() {
  clips = createClipStore(path.join(app.getPath("temp"), "Surf", "utterances"));
  activity = createLog({ file: path.join(surfDir(), "activity.log") });
  logLines = await activity.load();
  activity.onChange((lines) => {
    logLines = lines;
    publish();
  });
  loop = createLoop({
    name: settings.agentName,
    log: activity,
    deleteClip: (file) => clips.deleteClip(file),
    transcribe: async (file) => transcribeFile({ filePath: file, apiKey: await store.readKey() }),
    decide: async (text) => decide({ transcript: text, apiKey: await store.readKey() }),
    speak: (line) => playLine(line),
    onState: () => publish(),
    runAgent: async ({ transcript, signal, onStep }) => {
      const session = createMcpSession({ spawn });
      try {
        await session.start();
      } catch (error) {
        return "Desktop control is not available.";
      }
      const desktop = createDesktop({
        call: (command, args) => session.call(command, args),
        log: activity,
        onStep,
        confirm,
      });
      try {
        return await runToolLoop({
          transcript,
          foregroundTitle: "",
          desktop,
          signal,
        });
      } finally {
        session.close();
      }
    },
  });
}

async function onUtterance(step) {
  if (!loop || step.reason === "no-speech" || !step.pcm?.length) return;
  const wav = await clips.writeClip(step.pcm);
  await loop.handleClip({ wavPath: wav });
}

async function startElectronAudio() {
  const modelDir = path.join(surfDir(), "models", "vosk");
  try {
    await ensureVoskModel({ dir: modelDir });
  } catch (error) {
    errorText = "The speech model could not be downloaded.";
    publish();
    return;
  }
  dictionary = await readVoskWords(modelDir);
  voskFeed = await createVoskFeed({ modelPath: modelDir, name: settings.agentName });
  const listener = createListener({
    onWake(frame) {
      if (captureMode !== "wake" || muted) return false;
      return voskFeed.push(frame);
    },
    onUtterance: (step) => {
      onUtterance(step);
    },
  });
  let device;
  capture = createCapture({
    device: {
      async start() {
        device = await startPvCapture({
          onFrame(frame) {
            if (muted || captureMode === "confirm") {
              if (captureMode === "confirm") {
                const text = voskFeed.read(frame);
                const answer = interpretAnswer(text);
                if (answer !== null && heardConfirm) {
                  const resolve = heardConfirm;
                  heardConfirm = null;
                  resolve(answer ? "yes" : "no");
                }
              }
              return;
            }
            listener.push(frame);
          },
        });
      },
      async stop() {
        await device?.stop();
      },
    },
  });
  await capture.setMuted(false);
  muted = false;
}

function startHelper() {
  hostPath = "helper";
  const nodeBin = process.env.SURF_NODE || "node";
  helper = spawn(nodeBin, [path.join(here, "audio-helper.js")], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const rl = readline.createInterface({ input: helper.stdout });
  rl.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.type === "error") {
      errorText = message.error;
      publish();
    }
    if (message.type === "utterance" && message.wav) {
      loop?.handleClip({ wavPath: message.wav });
    }
  });
  helper.stdin.write(
    `${JSON.stringify({
      type: "start",
      name: settings.agentName,
      model: path.join(surfDir(), "models", "vosk"),
    })}\n`,
  );
}

async function bootAudio() {
  const probed = await probeNativeAudio();
  hostPath = probed;
  if (probed === "electron") {
    try {
      await startElectronAudio();
      return;
    } catch {
      hostPath = "helper";
    }
  }
  startHelper();
}

async function setMuted(next) {
  muted = Boolean(next);
  await capture?.setMuted(muted);
  helper?.stdin.write(`${JSON.stringify({ type: "mute", muted })}\n`);
  if (loop) await loop.setMuted(muted);
  else publish();
  rebuildTray();
}

function createWindow() {
  const position = settings?.windowPosition;
  win = new BrowserWindow({
    width: 320,
    height: needsSetup ? 300 : expanded ? 440 : 72,
    x: position?.x,
    y: position?.y,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#101614",
    webPreferences: {
      preload: path.join(here, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(renderer);
  win.once("ready-to-show", () => {
    win.show();
    publish();
  });
  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on("moved", async () => {
    if (!store || needsSetup) return;
    const [x, y] = win.getPosition();
    settings = await store.update({ windowPosition: { x, y } });
  });
}

async function quit() {
  quitting = true;
  await clips?.deleteAllClips().catch(() => {});
  helper?.stdin.write('{"type":"stop"}\n');
  helper?.kill();
  await capture?.setMuted(true).catch(() => {});
  app.quit();
}

app.whenReady().then(async () => {
  await fs.mkdir(surfDir(), { recursive: true });
  store = createSettingsStore({ dir: surfDir(), safeStorage });
  settings = await store.load();
  const keyReady = await store.readKey().then(
    () => true,
    () => false,
  );
  needsSetup = !settings || !keyReady;
  expanded = Boolean(settings?.expanded);
  createWindow();
  tray = new Tray(trayImage());
  tray.setToolTip("Surf");
  rebuildTray();
  if (!needsSetup) {
    try {
      await ensureLoop();
      await bootAudio();
    } catch (error) {
      errorText = error.message;
      publish();
    }
  }
});

ipcMain.handle("get-state", () => publish());
ipcMain.handle("submit-setup", async (_event, payload) => {
  try {
    const modelDir = path.join(surfDir(), "models", "vosk");
    try {
      await ensureVoskModel({ dir: modelDir });
      dictionary = await readVoskWords(modelDir);
    } catch {
      dictionary = null;
    }
    if (!dictionary) {
      errorText = "The speech model could not be downloaded.";
      publish();
      return { ok: false, error: errorText };
    }
    settings = await store.save({
      agentName: payload.name,
      apiKey: payload.apiKey,
      voiceId: "eve",
      dictionary,
    });
    needsSetup = false;
    errorText = "";
    resize();
    await ensureLoop();
    await bootAudio();
    publish();
    return { ok: true };
  } catch (error) {
    errorText = error.message;
    publish();
    return { ok: false, error: error.message };
  }
});
ipcMain.handle("set-muted", async (_event, next) => {
  await setMuted(next);
  return publish();
});
ipcMain.handle("set-expanded", async (_event, next) => {
  expanded = Boolean(next);
  if (store && settings) settings = await store.update({ expanded });
  resize();
  return publish();
});
ipcMain.handle("stop", () => {
  loop?.stop();
  return publish();
});
ipcMain.handle("confirm", (_event, yes) => {
  if (confirmResolve) {
    const resolve = confirmResolve;
    confirmResolve = null;
    resolve(Boolean(yes));
  }
  return publish();
});
ipcMain.handle("rename", async (_event, name) => {
  try {
    settings = await store.update({ agentName: name }, dictionary);
    errorText = "";
    voskFeed?.setName(settings.agentName);
  } catch (error) {
    errorText = error.message;
  }
  return publish();
});
ipcMain.handle("set-voice", async (_event, voiceId) => {
  settings = await store.update({ voiceId: voiceId || "eve" });
  return publish();
});
ipcMain.handle("playback-ended", (_event, id) => {
  if (playWait?.id === id) {
    const resolve = playWait.resolve;
    playWait = null;
    resolve();
  }
});
ipcMain.handle("quit", () => quit());

void hostPath;
