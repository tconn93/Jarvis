import fs from "node:fs/promises";
import path from "node:path";

const KINDS = new Set(["heard", "step", "said", "error"]);

export function createLog({
  file,
  fs: fsImpl = fs,
  max = 200,
  clock = () => new Date().toISOString(),
} = {}) {
  let lines = [];
  const listeners = new Set();

  async function load() {
    try {
      const raw = await fsImpl.readFile(file, "utf8");
      lines = raw
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .slice(-max);
    } catch {
      lines = [];
    }
    return lines;
  }

  async function persist() {
    if (!file) return;
    await fsImpl.mkdir(path.dirname(file), { recursive: true });
    const body = lines.map((line) => JSON.stringify(line)).join("\n");
    await fsImpl.writeFile(file, body.length ? `${body}\n` : "");
  }

  return {
    load,
    lines: () => lines.slice(),
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async append(kind, text) {
      if (!KINDS.has(kind)) throw new Error(`Unknown log kind: ${kind}`);
      lines.push({ at: clock(), kind, text: String(text) });
      if (lines.length > max) lines = lines.slice(lines.length - max);
      await persist();
      for (const fn of listeners) fn(lines.slice());
      return lines.length;
    },
  };
}
