import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSettingsStore, validateAgentName } from "../src/settings.js";

test("rejects a one-character name and punctuation other than an apostrophe", () => {
  assert.equal(validateAgentName("A").ok, false);
  assert.equal(validateAgentName("Hi!").ok, false);
  assert.equal(validateAgentName("Nova").ok, true);
  assert.equal(validateAgentName("Blue Sky").name, "Blue Sky");
  assert.equal(validateAgentName("O'Neil").ok, true);
});

test("rejects an out-of-vocabulary name", () => {
  const dictionary = new Set(["nova", "blue", "sky"]);
  assert.equal(validateAgentName("Nova", dictionary).ok, true);
  assert.equal(validateAgentName("Blue Sky", dictionary).ok, true);
  const rejected = validateAgentName("Zzxq", dictionary);
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /dictionary/i);
});

test("safeStorage double writes the ciphertext outside the project", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "surf-settings-"));
  const store = createSettingsStore({
    dir,
    safeStorage: {
      encryptString(value) {
        return Buffer.from(`cipher:${value}`, "utf8");
      },
      decryptString(buf) {
        return Buffer.from(buf).toString("utf8").replace(/^cipher:/, "");
      },
    },
  });
  await store.save({ agentName: "Nova", apiKey: "xai-test-key" });
  const settings = await fs.readFile(store.settingsPath, "utf8");
  assert.equal(settings.includes("xai-test-key"), false);
  const secret = await fs.readFile(store.secretPath);
  assert.equal(secret.toString("utf8"), "cipher:xai-test-key");
  assert.ok(store.secretPath.startsWith(os.tmpdir()));
  assert.equal(await store.readKey(), "xai-test-key");
  await fs.rm(dir, { recursive: true, force: true });
});
