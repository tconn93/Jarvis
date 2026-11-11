import assert from "node:assert/strict";
import test from "node:test";
import { createCapture } from "../src/audio.js";
import { createLoop } from "../src/loop.js";

function harness(overrides = {}) {
  const calls = [];
  const loop = createLoop({
    transcribe: async () => "open notepad",
    decide: async () => ({ is_command: true, reply: "" }),
    runAgent: async () => {
      calls.push("agent");
      return "Opened Notepad.";
    },
    speak: async (line) => {
      calls.push(["speak", line]);
    },
    log: {
      async append(kind, text) {
        calls.push(["log", kind, text]);
      },
    },
    deleteClip: async (file) => {
      calls.push(["delete", file]);
    },
    ...overrides,
    calls,
  });
  return { loop, calls };
}

test("a yes transcript speaks, logs, and deletes the clip", async () => {
  const { loop, calls } = harness();
  await loop.handleClip({ wavPath: "clip.wav" });
  assert.ok(calls.includes("agent"));
  assert.deepEqual(
    calls.filter((item) => Array.isArray(item) && item[0] === "log").map((item) => item[1]),
    ["heard", "said"],
  );
  assert.equal(calls.some((item) => Array.isArray(item) && item[0] === "speak"), true);
  assert.deepEqual(calls.at(-1), ["delete", "clip.wav"]);
});

test("a no transcript does not call the agent, speech, or the logger", async () => {
  const { loop, calls } = harness({
    decide: async () => ({ is_command: false, reply: "" }),
  });
  const state = await loop.handleClip({ wavPath: "clip.wav" });
  assert.deepEqual(calls, [["delete", "clip.wav"]]);
  assert.equal(state.status, "listening");
});

test("a muted recorder produces no wake event", async () => {
  const wakes = [];
  const device = { async start() {}, async stop() {} };
  const capture = createCapture({
    device,
    onFrame() {
      wakes.push("frame");
    },
  });
  await capture.setMuted(true);
  capture.push(Int16Array.from([2000]));
  assert.equal(wakes.length, 0);

  const { loop, calls } = harness();
  await loop.setMuted(true);
  await loop.handleClip({ wavPath: "clip.wav" });
  assert.deepEqual(calls, [["delete", "clip.wav"]]);
});

test("stop while working speaks that it stopped", async () => {
  let release;
  const { loop } = harness({
    runAgent: ({ signal }) =>
      new Promise((resolve, reject) => {
        release = resolve;
        signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
  });
  const pending = loop.handleClip({ wavPath: "clip.wav" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  loop.stop();
  const state = await pending;
  assert.equal(state.lastSaid, "I stopped.");
  void release;
});
