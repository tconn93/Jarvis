import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import { createBridge } from "../src/bridge/server.js";

function openSocket(port) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

test("bridge stays on localhost, rejects a bad token, and round-trips a call", async () => {
  const bridge = createBridge();
  const started = await bridge.start({ port: 47321, maxPort: 47330 });
  assert.equal(bridge.address().address, "127.0.0.1");
  assert.ok(started.port >= 47321 && started.port <= 47330);

  const health = await fetch(`http://127.0.0.1:${started.port}/health`);
  const healthBody = await health.json();
  assert.equal(healthBody.ok, "ok");
  assert.equal(healthBody.port, started.port);
  assert.equal(JSON.stringify(healthBody).includes("token"), false);

  const code = bridge.beginPair();
  const bad = await fetch(`http://127.0.0.1:${started.port}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "NOPE" }),
  });
  assert.equal(bad.status, 401);

  const paired = await fetch(`http://127.0.0.1:${started.port}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const { token } = await paired.json();
  assert.equal(typeof token, "string");
  assert.ok(token.length >= 32);

  const wrong = await openSocket(started.port);
  const closed = new Promise((resolve) => wrong.once("close", resolve));
  wrong.send(JSON.stringify({ type: "auth", token: "wrong" }));
  await closed;

  const socket = await openSocket(started.port);
  socket.send(JSON.stringify({ type: "auth", token }));
  await new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (bridge.connected()) resolve();
      else if (Date.now() - startedAt > 2000) reject(new Error("socket did not authenticate"));
      else setTimeout(check, 10);
    };
    check();
  });
  const incoming = new Promise((resolve) => {
    socket.once("message", (data) => resolve(JSON.parse(String(data))));
  });
  const pending = bridge.call("browser_open_tab", { url: "https://example.com" });
  const message = await incoming;
  assert.equal(message.type, "call");
  assert.equal(message.tool, "browser_open_tab");
  assert.deepEqual(message.args, { url: "https://example.com" });
  socket.send(JSON.stringify({ id: message.id, type: "result", ok: true, data: { tabId: 12 } }));
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.data.tabId, 12);
  socket.close();
  await bridge.close();
  void code;
});
