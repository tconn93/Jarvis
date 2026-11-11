import assert from "node:assert/strict";
import test from "node:test";
import { askConfirmation } from "../src/confirm.js";

function never() {
  return new Promise(() => {});
}

function ask(overrides) {
  return askConfirmation({
    question: "Close Notepad?",
    speak: async () => {},
    listen: () => never(),
    button: () => never(),
    sleep: () => never(),
    ...overrides,
  });
}

test("yes, no, another phrase, a button, and a 15 second timeout", async () => {
  assert.equal(await ask({ listen: async () => "yes" }), true);
  assert.equal(await ask({ listen: async () => "no" }), false);
  assert.equal(await ask({ listen: async () => "maybe later" }), false);

  let waited = 0;
  const timedOut = await ask({
    sleep: async (ms) => {
      waited = ms;
    },
  });
  assert.equal(timedOut, false);
  assert.equal(waited, 15000);

  assert.equal(await ask({ button: async () => true }), true);
});
