// System-node helper used only when vosk or pvrecorder fail to load inside
// Electron. One JSON object per line on stdin and stdout.
//
// in:  {"type":"start","name":"Nova","model":"..."}
//      {"type":"mute","muted":true}
//      {"type":"stop"}
// out: {"type":"ready","path":"helper"}
//      {"type":"wake"}
//      {"type":"utterance","wav":"...","reason":"silence"}
//      {"type":"error","error":"..."}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { createClipStore, createListener, startPvCapture } from "./audio.js";
import { createVoskFeed } from "./wake.js";

const out = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

let capture = null;
let muted = false;

async function start(message) {
  const dir = path.join(os.tmpdir(), "Surf", "utterances");
  const clips = createClipStore(dir);
  const feed = await createVoskFeed({
    modelPath: message.model,
    name: message.name,
  });
  const listener = createListener({
    onWake(frame) {
      if (muted) return false;
      return feed.push(frame);
    },
    onUtterance: async (step) => {
      if (step.reason === "no-speech" || step.pcm.length === 0) {
        out({ type: "utterance", reason: "no-speech" });
        return;
      }
      const wav = await clips.writeClip(step.pcm);
      out({ type: "wake" });
      out({ type: "utterance", wav, reason: step.reason });
    },
  });
  capture = await startPvCapture({
    onFrame(frame) {
      if (!muted) listener.push(frame);
    },
  });
  out({ type: "ready", path: "helper" });
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.type === "start") {
    start(message).catch((error) => out({ type: "error", error: error.message }));
  } else if (message.type === "mute") {
    muted = Boolean(message.muted);
  } else if (message.type === "stop") {
    Promise.resolve(capture?.stop()).finally(() => process.exit(0));
  }
});

process.stdin.on("end", () => process.exit(0));
void fs;
