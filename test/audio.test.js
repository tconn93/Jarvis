import assert from "node:assert/strict";
import test from "node:test";
import { createCapture, createListener, SILENCE_RMS } from "../src/audio.js";

test("mute stops the recorder before the next frame is kept", async () => {
  const device = { starts: 0, stops: 0, async start() { this.starts += 1; }, async stop() { this.stops += 1; } };
  const frames = [];
  const capture = createCapture({
    device,
    onFrame(frame) {
      frames.push(frame);
    },
  });
  await capture.setMuted(false);
  capture.push(Int16Array.from([800, 800]));
  await capture.setMuted(true);
  capture.push(Int16Array.from([800, 800]));
  await capture.setMuted(false);
  capture.push(Int16Array.from([800, 800]));
  assert.equal(device.starts, 2);
  assert.equal(device.stops, 1);
  assert.equal(frames.length, 2);
});

test("command recording ends on trailing silence and on no speech", () => {
  const reasons = [];
  const listener = createListener({
    frameMs: 100,
    startGraceMs: 300,
    trailMs: 200,
    maxMs: 1000,
    silenceRms: SILENCE_RMS,
    onWake(frame) {
      return frame[0] === 1;
    },
    onUtterance(step) {
      reasons.push(step.reason);
    },
  });
  const quiet = Int16Array.from([0, 0, 0]);
  const loud = Int16Array.from([4000, 4000, 4000]);
  listener.push(quiet);
  listener.push(Int16Array.from([1, 0, 0]));
  listener.push(quiet);
  listener.push(quiet);
  listener.push(quiet);
  assert.deepEqual(reasons, ["no-speech"]);

  listener.push(Int16Array.from([1, 0, 0]));
  listener.push(loud);
  listener.push(quiet);
  listener.push(quiet);
  assert.equal(reasons.at(-1), "silence");
});
