import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createClipStore } from "../src/audio.js";

test("deleteClip and deleteAllClips remove wav files", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "surf-clips-"));
  const clips = createClipStore(dir);
  const first = await clips.writeClip(Int16Array.from([0, 1000, -1000]));
  const second = await clips.writeClip(Int16Array.from([1, 2, 3]));
  assert.equal(await fileExists(first), true);
  await clips.deleteClip(first);
  assert.equal(await fileExists(first), false);
  assert.equal(await fileExists(second), true);
  await clips.deleteAllClips();
  assert.equal(await fileExists(second), false);
  await fs.rm(dir, { recursive: true, force: true });
});

function fileExists(file) {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}
