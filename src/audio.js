// Audio host decision (Build 1, step 1):
// Surf first loads `vosk` and `@picovoice/pvrecorder-node` inside the Electron
// main process via probeNativeAudio(). If either import throws an ABI error,
// main.js starts src/audio-helper.js with the system `node` binary and talks
// JSON lines over stdin/stdout. The window stays in Electron. The winning path
// is recorded on the host object as `path`: "electron" or "helper".
//
// Silence threshold: Design.md refers to frame energy without a number.
// A frame is silence when its int16 RMS is under SILENCE_RMS (500).

import fs from "node:fs/promises";
import path from "node:path";

export const SILENCE_RMS = 500;
export const SAMPLE_RATE = 16000;

export function rmsInt16(samples) {
  if (!samples || samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

export function isSilence(samples, threshold = SILENCE_RMS) {
  return rmsInt16(samples) < threshold;
}

export function encodeWav(pcm, sampleRate = SAMPLE_RATE) {
  const samples = pcm instanceof Int16Array ? pcm : Int16Array.from(pcm);
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(samples[i], 44 + i * 2);
  }
  return buffer;
}

function concat(frames) {
  const total = frames.reduce((n, frame) => n + frame.length, 0);
  const out = new Int16Array(total);
  let offset = 0;
  for (const frame of frames) {
    out.set(frame, offset);
    offset += frame.length;
  }
  return out;
}

export function createUtteranceBuffer({
  frameMs = 32,
  silenceRms = SILENCE_RMS,
  startGraceMs = 2500,
  trailMs = 700,
  maxMs = 15000,
} = {}) {
  let frames = [];
  let heardSpeech = false;
  let silenceMs = 0;
  let totalMs = 0;

  function reset() {
    frames = [];
    heardSpeech = false;
    silenceMs = 0;
    totalMs = 0;
  }

  return {
    reset,
    push(frame) {
      totalMs += frameMs;
      const silent = isSilence(frame, silenceRms);
      if (!silent) {
        heardSpeech = true;
        silenceMs = 0;
        frames.push(frame);
      } else if (!heardSpeech) {
        silenceMs += frameMs;
        if (silenceMs >= startGraceMs) {
          const pcm = concat(frames);
          reset();
          return { done: true, reason: "no-speech", pcm };
        }
      } else {
        silenceMs += frameMs;
        frames.push(frame);
        if (silenceMs >= trailMs || totalMs >= maxMs) {
          const pcm = concat(frames);
          const reason = silenceMs >= trailMs ? "silence" : "max";
          reset();
          return { done: true, reason, pcm };
        }
      }
      if (totalMs >= maxMs) {
        const pcm = concat(frames);
        reset();
        return { done: true, reason: "max", pcm };
      }
      return { done: false };
    },
  };
}

export function createListener({
  onWake,
  onUtterance,
  frameMs,
  silenceRms,
  startGraceMs,
  trailMs,
  maxMs,
} = {}) {
  const buffer = createUtteranceBuffer({
    frameMs,
    silenceRms,
    startGraceMs,
    trailMs,
    maxMs,
  });
  let hearing = false;
  return {
    get hearing() {
      return hearing;
    },
    push(frame) {
      if (!hearing) {
        if (onWake(frame)) {
          hearing = true;
          buffer.reset();
        }
        return;
      }
      const step = buffer.push(frame);
      if (step.done) {
        hearing = false;
        onUtterance(step);
      }
    },
  };
}

export function createCapture({ device, onFrame }) {
  let muted = true;
  let running = false;
  return {
    get muted() {
      return muted;
    },
    get running() {
      return running;
    },
    async setMuted(next) {
      const wantMuted = Boolean(next);
      if (wantMuted === muted && (wantMuted || running)) return;
      muted = wantMuted;
      if (muted && running) {
        await device.stop();
        running = false;
        return;
      }
      if (!muted && !running) {
        await device.start();
        running = true;
      }
    },
    push(frame) {
      if (muted || !running) return;
      onFrame?.(frame);
    },
  };
}

export function createClipStore(dir, fsImpl = fs) {
  return {
    async writeClip(pcm) {
      await fsImpl.mkdir(dir, { recursive: true });
      const file = path.join(
        dir,
        `utt-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`,
      );
      await fsImpl.writeFile(file, encodeWav(pcm));
      return file;
    },
    async deleteClip(file) {
      if (!file) return;
      await fsImpl.rm(file, { force: true });
    },
    async deleteAllClips() {
      let names = [];
      try {
        names = await fsImpl.readdir(dir);
      } catch {
        return;
      }
      await Promise.all(
        names
          .filter((name) => name.endsWith(".wav"))
          .map((name) => fsImpl.rm(path.join(dir, name), { force: true })),
      );
    },
  };
}

export async function probeNativeAudio() {
  try {
    await import("vosk");
    await import("@picovoice/pvrecorder-node");
    return "electron";
  } catch {
    return "helper";
  }
}

export async function startPvCapture({ onFrame }) {
  const { PvRecorder } = await import("@picovoice/pvrecorder-node");
  const frameLength = 512;
  const recorder = new PvRecorder(frameLength, -1);
  recorder.start();
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      const pcm = await recorder.read();
      if (stopped) break;
      onFrame(Int16Array.from(pcm));
    }
  })();
  return {
    async stop() {
      stopped = true;
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
      try {
        recorder.release();
      } catch {
        /* already released */
      }
      await loop.catch(() => {});
    },
  };
}
