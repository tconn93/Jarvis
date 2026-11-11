import assert from "node:assert/strict";
import test from "node:test";
import { runToolLoop, twoSentences } from "../src/agent.js";

test("finish on round 1 makes no further request", async () => {
  let calls = 0;
  const line = await runToolLoop({
    transcript: "open notepad",
    foregroundTitle: "Desktop",
    request: async () => {
      calls += 1;
      return {
        id: "r1",
        output: [
          {
            type: "function_call",
            name: "finish",
            call_id: "c1",
            arguments: '{"text":"Opened Notepad. Extra sentence. And a third."}',
          },
        ],
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(line, "Opened Notepad. Extra sentence.");
  assert.equal(twoSentences("One. Two. Three."), "One. Two.");
});

test("a model that keeps calling tools stops at 8 rounds", async () => {
  let calls = 0;
  const line = await runToolLoop({
    transcript: "open notepad",
    call: async () => ({ ok: true, data: {} }),
    log: { async append() {} },
    request: async () => {
      calls += 1;
      return {
        id: `r${calls}`,
        output: [
          {
            type: "function_call",
            name: "list_windows",
            call_id: `c${calls}`,
            arguments: "{}",
          },
        ],
      };
    },
  });
  assert.equal(calls, 8);
  assert.equal(line, "I stopped before finishing.");
});
