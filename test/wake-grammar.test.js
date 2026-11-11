import assert from "node:assert/strict";
import test from "node:test";
import { buildGrammar, grammarPhrases, hearWake } from "../src/wake.js";

test("grammar for Nova contains only that phrase", () => {
  const grammar = buildGrammar("Nova");
  assert.deepEqual(grammarPhrases(grammar), ["Nova"]);
  assert.ok(grammar.includes("[unk]"));
});

test("grammar for Blue Sky contains only that phrase", () => {
  assert.deepEqual(grammarPhrases(buildGrammar("Blue Sky")), ["Blue Sky"]);
});

test("silence and other words are not a wake", () => {
  assert.equal(hearWake("", "Nova"), false);
  assert.equal(hearWake("the weather", "Nova"), false);
  assert.equal(hearWake("Nova", "Nova"), true);
  assert.equal(hearWake("nova open notepad", "Nova"), true);
});
