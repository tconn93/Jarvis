import fs from "node:fs/promises";
import path from "node:path";

const NAME_PATTERN = /^[A-Za-z0-9']+(?: [A-Za-z0-9']+)*$/;

export function validateAgentName(name, dictionary) {
  if (typeof name !== "string") {
    return { ok: false, error: "Name must be 2 to 32 characters." };
  }
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 32) {
    return { ok: false, error: "Name must be 2 to 32 characters." };
  }
  if (!NAME_PATTERN.test(trimmed)) {
    return {
      ok: false,
      error: "Use letters, numbers, spaces, and apostrophes only.",
    };
  }
  if (dictionary) {
    const missing = trimmed
      .split(" ")
      .filter((word) => !dictionary.has(word.toLowerCase()));
    if (missing.length > 0) {
      return {
        ok: false,
        error: `Not in the speech dictionary: ${missing.join(", ")}`,
      };
    }
  }
  return { ok: true, name: trimmed };
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function createSettingsStore({ dir, safeStorage, fs: fsImpl = fs }) {
  const settingsPath = path.join(dir, "settings.json");
  const secretPath = path.join(dir, "secret.bin");

  async function load() {
    const data = await readJson(settingsPath, null);
    if (!data?.agentName) return null;
    return {
      agentName: data.agentName,
      voiceId: data.voiceId || "eve",
      expanded: Boolean(data.expanded),
      windowPosition: data.windowPosition ?? null,
      cookieChoice: data.cookieChoice === "accept" ? "accept" : "reject",
    };
  }

  async function writeSettings(next) {
    await fsImpl.mkdir(dir, { recursive: true });
    await fsImpl.writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`);
  }

  return {
    load,
    settingsPath,
    secretPath,
    async save({ agentName, apiKey, voiceId, expanded, windowPosition, dictionary }) {
      const check = validateAgentName(agentName, dictionary);
      if (!check.ok) {
        const error = new Error(check.error);
        error.code = "BAD_NAME";
        throw error;
      }
      if (typeof apiKey !== "string" || apiKey.trim() === "") {
        throw new Error("API key is required.");
      }
      const next = {
        agentName: check.name,
        voiceId: voiceId || "eve",
        expanded: Boolean(expanded),
        windowPosition: windowPosition ?? null,
        cookieChoice: "reject",
      };
      await writeSettings(next);
      const cipher = safeStorage.encryptString(apiKey.trim());
      const buf = Buffer.isBuffer(cipher) ? cipher : Buffer.from(cipher);
      await fsImpl.writeFile(secretPath, buf);
      await fsImpl.chmod(secretPath, 0o600);
      return next;
    },
    async update(partial, dictionary) {
      const current = (await load()) ?? {
        agentName: "",
        voiceId: "eve",
        expanded: false,
        windowPosition: null,
        cookieChoice: "reject",
      };
      if (partial.agentName != null) {
        const check = validateAgentName(partial.agentName, dictionary);
        if (!check.ok) throw new Error(check.error);
        current.agentName = check.name;
      }
      if (partial.voiceId) current.voiceId = String(partial.voiceId);
      if (typeof partial.expanded === "boolean") current.expanded = partial.expanded;
      if (partial.windowPosition) current.windowPosition = partial.windowPosition;
      if (partial.cookieChoice === "accept" || partial.cookieChoice === "reject") {
        current.cookieChoice = partial.cookieChoice;
      }
      await writeSettings(current);
      return current;
    },
    async readKey() {
      const buf = await fsImpl.readFile(secretPath);
      return safeStorage.decryptString(buf);
    },
  };
}
