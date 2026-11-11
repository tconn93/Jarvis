import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const VOSK_SMALL_EN_URL =
  "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip";

export function buildGrammar(name) {
  return [name, "[unk]"];
}

export function grammarPhrases(grammar) {
  return grammar.filter((phrase) => phrase !== "[unk]");
}

export function hearWake(transcript, name) {
  if (!transcript || !name) return false;
  const text = String(transcript).trim().toLowerCase();
  const wake = String(name).trim().toLowerCase();
  if (!text || !wake) return false;
  return text === wake || text.startsWith(`${wake} `);
}

export async function readVoskWords(modelDir) {
  const candidates = [
    path.join(modelDir, "graph", "words.txt"),
    path.join(modelDir, "words.txt"),
  ];
  for (const file of candidates) {
    try {
      const raw = await fs.readFile(file, "utf8");
      const words = new Set();
      for (const line of raw.split("\n")) {
        const token = line.trim().split(/\s+/)[0];
        if (!token || token.startsWith("<") || token.startsWith("[")) continue;
        words.add(token.toLowerCase());
      }
      if (words.size > 0) return words;
    } catch {
      /* try the next location */
    }
  }
  return null;
}

async function extractZip(zipPath, dest) {
  await fs.mkdir(dest, { recursive: true });
  if (process.platform === "win32") {
    await execFileAsync("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -Force -LiteralPath '${zipPath}' -DestinationPath '${dest}'`,
    ]);
    return;
  }
  try {
    await execFileAsync("unzip", ["-o", zipPath, "-d", dest]);
  } catch {
    await execFileAsync("python3", ["-m", "zipfile", "-e", zipPath, dest]);
  }
}

export async function ensureVoskModel({
  dir,
  fetchImpl = fetch,
  url = VOSK_SMALL_EN_URL,
}) {
  const marker = path.join(dir, "conf");
  try {
    await fs.access(marker);
    return dir;
  } catch {
    /* download once */
  }
  await fs.mkdir(dir, { recursive: true });
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Could not download the speech model (${response.status}).`);
  const zipPath = path.join(dir, "model.zip");
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(zipPath, bytes);
  const staging = path.join(dir, "_unpack");
  await extractZip(zipPath, staging);
  const entries = await fs.readdir(staging);
  const nested = entries.find((name) => name.startsWith("vosk-model"));
  const source = nested ? path.join(staging, nested) : staging;
  const inner = await fs.readdir(source);
  await Promise.all(
    inner.map((name) => fs.rename(path.join(source, name), path.join(dir, name))),
  );
  await fs.rm(staging, { recursive: true, force: true });
  await fs.rm(zipPath, { force: true });
  return dir;
}

export async function createVoskFeed({ modelPath, name: initialName }) {
  let name = initialName;
  const vosk = await import("vosk");
  const mod = vosk.default ?? vosk;
  if (typeof mod.setLogLevel === "function") mod.setLogLevel(-1);
  const model = new mod.Model(modelPath);
  let rec = openRecognizer(mod, model, name);

  function openRecognizer(api, speechModel, agentName) {
    const recognizer = new api.Recognizer({ model: speechModel, sampleRate: 16000 });
    recognizer.setGrammar(buildGrammar(agentName));
    return recognizer;
  }

  function applyGrammar(agentName, grammar = buildGrammar(agentName)) {
    try {
      rec.free?.();
    } catch {
      /* ignore */
    }
    rec = openRecognizer(mod, model, agentName);
    if (grammar) rec.setGrammar(grammar);
    return rec;
  }

  return {
    setName(next) {
      name = next;
      applyGrammar(name, buildGrammar(name));
    },
    setGrammar(grammar) {
      applyGrammar(name, grammar);
    },
    read(frame) {
      const buffer = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
      const accepted = rec.acceptWaveform(buffer);
      const payload = accepted ? JSON.parse(rec.result()) : JSON.parse(rec.partialResult());
      return payload.text || payload.partial || "";
    },
    push(frame) {
      const text = this.read(frame);
      if (!hearWake(text, name)) return false;
      rec.reset?.();
      return true;
    },
  };
}
