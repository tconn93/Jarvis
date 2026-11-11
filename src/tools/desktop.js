const RISKY =
  /\b(delete|remove|send|pay|purchase|buy|checkout)\b|\bplace\s+order\b/i;

const BLOCKED_CHORDS = new Set(["win+r", "win+x", "alt+f4"]);

export function isRawPath(value) {
  const text = String(value ?? "").trim();
  if (!text) return true;
  if (/[\\/]/.test(text)) return true;
  if (/^[a-zA-Z]:/.test(text)) return true;
  if (/\.(exe|bat|cmd|com|ps1|lnk)$/i.test(text)) return true;
  return false;
}

export function normalizeChord(keys) {
  return String(keys ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/windows|meta|super|cmd/g, "win");
}

export function isRejectedChord(keys) {
  return BLOCKED_CHORDS.has(normalizeChord(keys));
}

export function isRiskyControl(name) {
  return RISKY.test(String(name ?? ""));
}

export function capTree(node, maxDepth = 4, maxNodes = 80) {
  let count = 0;
  function walk(current, depth) {
    if (!current || typeof current !== "object") return null;
    if (count >= maxNodes) {
      return { name: current.name ?? "", role: current.role ?? "", truncated: true };
    }
    count += 1;
    const out = {
      name: current.name ?? current.label ?? "",
      role: current.role ?? current.type ?? "",
      enabled: current.enabled !== false,
    };
    const children = Array.isArray(current.children) ? current.children : [];
    if (depth >= maxDepth) {
      if (children.length > 0) out.truncated = true;
      return out;
    }
    if (children.length > 0) {
      out.children = [];
      for (const child of children) {
        if (count >= maxNodes) {
          out.truncated = true;
          break;
        }
        out.children.push(walk(child, depth + 1));
      }
    }
    return out;
  }
  return walk(node, 0);
}

function toolError(error) {
  return { ok: false, error };
}

export function createDesktop({ call, log, onStep, confirm }) {
  async function run(stepText, command, args) {
    if (log) await log.append("step", stepText);
    onStep?.(stepText);
    try {
      const result = await call(command, args);
      if (!result || result.ok === false) {
        return toolError(result?.error || "The desktop command failed.");
      }
      return { ok: true, data: result.data ?? result };
    } catch (error) {
      return toolError(error.message || "The desktop command failed.");
    }
  }

  return {
    list_windows() {
      return run("Listed open windows.", "list-windows", {});
    },
    launch_app(args = {}) {
      const name = args.name ?? args.app ?? "";
      if (isRawPath(name)) {
        return toolError("A display name is required, not a file path.");
      }
      return run(`Launched ${name}.`, "launch", { name });
    },
    focus_window(args = {}) {
      const label = args.title || args.name || "the window";
      return run(`Focused ${label}.`, "focus-window", {
        title: args.title,
        name: args.name,
      });
    },
    async inspect_window(args = {}) {
      const label = args.title || args.name || "the window";
      const result = await run(`Inspected ${label}.`, "snapshot", {
        name: args.name,
        title: args.title,
        depth: 4,
      });
      if (!result.ok) return result;
      const tree = capTree(result.data?.tree ?? result.data, 4, 80);
      return { ok: true, data: { tree } };
    },
    async invoke_control(args = {}) {
      const name = String(args.name ?? "");
      if (isRiskyControl(name) && !args.confirmed) {
        if (!confirm) return toolError("confirmation required");
        const yes = await confirm(`${name}?`);
        if (!yes) return { ok: false, error: "Cancelled.", cancelled: true };
      }
      return run(`Clicked ${name}.`, "click", { name });
    },
    set_text(args = {}) {
      const text = args.text ?? "";
      const command = args.name ? "set-value" : "type";
      const label = args.name || "the focused field";
      return run(`Typed into ${label}.`, command, {
        name: args.name,
        text,
        stdin: true,
      });
    },
    press_keys(args = {}) {
      const keys = args.keys ?? args.chord ?? "";
      if (isRejectedChord(keys)) {
        return toolError("That shortcut is blocked.");
      }
      return run(`Pressed ${keys}.`, "press", { keys });
    },
    read_text(args = {}) {
      const name = args.name || "the control";
      return run(`Read ${name}.`, "get", { name: args.name });
    },
    async close_window(args = {}) {
      if (!args.confirmed) {
        if (!confirm) return toolError("confirmation required");
        const label = args.title || args.name || "this window";
        const yes = await confirm(`Close ${label}?`);
        if (!yes) return { ok: false, error: "Cancelled.", cancelled: true };
      }
      const label = args.title || args.name || "the window";
      return run(`Closed ${label}.`, "close-app", {
        name: args.name,
        title: args.title,
      });
    },
  };
}

function encodeMessage(message) {
  const json = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
}

export function createMcpSession({
  spawn,
  command = "agent-desktop",
} = {}) {
  let child = null;
  let buffer = Buffer.alloc(0);
  let nextId = 1;
  const pending = new Map();
  let toolNames = [];

  function write(message) {
    child.stdin.write(encodeMessage(message));
  }

  function onData(chunk) {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length > 0) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = buffer.slice(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) return;
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (buffer.length < start + length) return;
      const body = buffer.slice(start, start + length).toString("utf8");
      buffer = buffer.slice(start + length);
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        continue;
      }
      if (message.id != null && pending.has(message.id)) {
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) {
          waiter.reject(new Error(message.error.message || "agent-desktop error"));
        } else {
          waiter.resolve(message.result);
        }
      }
    }
  }

  function send(method, params) {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      write({ jsonrpc: "2.0", id, method, params });
    });
  }

  function resolveTool(name) {
    const underscored = name.replaceAll("-", "_");
    const candidates = [`desktop_${underscored}`, underscored, name];
    return candidates.find((candidate) => toolNames.includes(candidate)) ?? candidates[0];
  }

  return {
    get spawnArgs() {
      return ["mcp"];
    },
    async start() {
      child = spawn(command, ["mcp"], { stdio: ["pipe", "pipe", "pipe"] });
      child.stdout.on("data", onData);
      child.stderr?.on?.("data", () => {});
      child.on?.("exit", () => {
        for (const waiter of pending.values()) {
          waiter.reject(new Error("agent-desktop exited"));
        }
        pending.clear();
      });
      await send("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "surf", version: "0.1.0" },
      });
      write({ jsonrpc: "2.0", method: "notifications/initialized" });
      try {
        const listed = await send("tools/list", {});
        toolNames = (listed?.tools ?? []).map((tool) => tool.name);
      } catch {
        toolNames = [];
      }
    },
    async call(desktopCommand, args) {
      try {
        const result = await send("tools/call", {
          name: resolveTool(desktopCommand),
          arguments: args,
        });
        const text = result?.content?.find((part) => part.type === "text")?.text;
        const envelope = text ? JSON.parse(text) : result;
        if (envelope && envelope.ok === false) {
          const error = envelope.error;
          return {
            ok: false,
            error: typeof error === "string" ? error : error?.message || "The desktop command failed.",
          };
        }
        return { ok: true, data: envelope?.data ?? envelope };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
    close() {
      child?.kill();
    },
  };
}
