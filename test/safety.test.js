import assert from "node:assert/strict";
import test from "node:test";
import {
  capTree,
  createDesktop,
  createMcpSession,
  isRawPath,
  isRejectedChord,
  resolveAgentDesktop,
} from "../src/tools/desktop.js";

function desktopWith(spy) {
  return createDesktop({
    call: async (command, args) => {
      spy.push({ command, args });
      return { ok: true, data: { title: "Notepad" } };
    },
    log: { async append() {} },
  });
}

test("the desktop helper is the native binary for this operating system", () => {
  const binary = resolveAgentDesktop();
  if (process.platform === "win32") {
    assert.match(binary, /agent-desktop-win32-.+\.exe$/);
  } else if (process.platform === "linux") {
    assert.match(binary, /agent-desktop-linux-/);
  } else {
    assert.match(binary, /agent-desktop/);
  }
});

test("launch_app rejects a path and does not call agent-desktop", async () => {
  const spy = [];
  const desktop = desktopWith(spy);
  assert.equal(isRawPath("C:\\Windows\\notepad.exe"), true);
  assert.equal(isRawPath("/usr/bin/gedit"), true);
  assert.equal(isRawPath("~/bin/app"), true);
  const result = await desktop.launch_app({ name: "/usr/bin/gedit" });
  assert.equal(result.ok, false);
  assert.equal(spy.length, 0);
  const ok = await desktop.launch_app({ name: "Notepad" });
  assert.equal(ok.ok, true);
  assert.equal(spy[0].command, "launch");
});

test("press_keys rejects Win+R, Win+X, and Alt+F4", async () => {
  const spy = [];
  const desktop = desktopWith(spy);
  for (const keys of ["Win+R", "Windows+X", "Alt+F4", "Ctrl+Alt+T", "Alt+F2", "Super+R"]) {
    assert.equal(isRejectedChord(keys), true);
    const result = await desktop.press_keys({ keys });
    assert.equal(result.ok, false);
  }
  assert.equal(spy.length, 0);
  const allowed = await desktop.press_keys({ keys: "Ctrl+S" });
  assert.equal(allowed.ok, true);
});

test("risky controls and close_window require confirmation", async () => {
  const spy = [];
  const desktop = desktopWith(spy);
  const removed = await desktop.invoke_control({ name: "Delete" });
  const closed = await desktop.close_window({ title: "Notepad" });
  assert.equal(removed.ok, false);
  assert.match(removed.error, /confirmation required/i);
  assert.match(closed.error, /confirmation required/i);
  assert.equal(spy.length, 0);

  let asked = 0;
  const confirming = createDesktop({
    call: async (command) => {
      spy.push(command);
      return { ok: true, data: {} };
    },
    log: { async append() {} },
    confirm: async () => {
      asked += 1;
      return true;
    },
  });
  const yes = await confirming.close_window({ title: "Notepad" });
  assert.equal(yes.ok, true);
  assert.equal(asked, 1);
  assert.equal(spy.at(-1), "close-app");
});

test("typed text is passed with stdin and not as a spawn argument", async () => {
  const spy = [];
  const desktop = desktopWith(spy);
  await desktop.set_text({ text: "hello from surf" });
  assert.equal(spy[0].args.text, "hello from surf");
  assert.equal(spy[0].args.stdin, true);

  let argv = [];
  const session = createMcpSession({
    spawn(_command, args) {
      argv = args;
      return {
        stdin: { write() {} },
        stdout: { on() {} },
        stderr: { on() {} },
        on() {},
        kill() {},
      };
    },
  });
  session.start().catch(() => {});
  assert.deepEqual(argv, ["mcp"]);
  assert.equal(argv.join(" ").includes("hello from surf"), false);
});

test("inspect_window caps depth and node count", () => {
  let node = { name: "root", role: "window", children: [] };
  let cursor = node;
  for (let i = 0; i < 8; i += 1) {
    const child = { name: `n${i}`, role: "group", children: [] };
    cursor.children.push(child);
    cursor = child;
  }
  const capped = capTree(node, 4, 80);
  let depth = 0;
  let walk = capped;
  while (walk?.children?.length) {
    depth += 1;
    walk = walk.children[0];
  }
  assert.ok(depth <= 4);
  assert.equal(walk.truncated, true);
});

test("notepad round trip", { skip: process.platform !== "win32" }, async () => {
  const { spawn } = await import("node:child_process");
  const session = createMcpSession({ spawn });
  await session.start();
  const desktop = createDesktop({
    call: session.call,
    log: { async append() {} },
  });
  const launched = await desktop.launch_app({ name: "Notepad" });
  assert.equal(launched.ok, true);
  const typed = await desktop.set_text({ text: "hello from surf" });
  assert.equal(typed.ok, true);
  const read = await desktop.read_text({ name: "Text Editor" });
  assert.equal(read.ok, true);
  assert.match(JSON.stringify(read.data), /hello from surf/);
  session.close();
});
