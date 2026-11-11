import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLog } from "../src/log.js";

test("keeps the newest 200 lines", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "surf-log-"));
  const file = path.join(dir, "activity.log");
  let tick = 0;
  const log = createLog({
    file,
    clock: () => `t${tick}`,
  });
  for (let i = 0; i < 201; i += 1) {
    tick = i;
    await log.append("step", `line ${i}`);
  }
  const lines = log.lines();
  assert.equal(lines.length, 200);
  assert.equal(lines[0].text, "line 1");
  assert.equal(lines.at(-1).text, "line 200");
  const raw = await fs.readFile(file, "utf8");
  assert.equal(raw.trim().split("\n").length, 200);
  await fs.rm(dir, { recursive: true, force: true });
});
