import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { speak } from "../src/speech.js";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

test("plays a wav and retries one 500", async () => {
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits += 1;
    if (hits === 1) {
      res.writeHead(500);
      res.end("no");
      return;
    }
    res.writeHead(200, { "content-type": "audio/wav" });
    res.end(Buffer.from("RIFFtiny"));
  });
  const port = await listen(server);
  const played = [];
  const result = await speak({
    text: "Opened Notepad.",
    voiceId: "eve",
    apiKey: "test",
    endpoint: `http://127.0.0.1:${port}/tts`,
    play: async (wav) => played.push(wav),
  });
  server.close();
  assert.equal(result.ok, true);
  assert.equal(played.length, 1);
  assert.equal(hits, 2);
});

test("a second 500 is reported without throwing", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(500);
    res.end("no");
  });
  const port = await listen(server);
  const played = [];
  const result = await speak({
    text: "Opened Notepad.",
    apiKey: "test",
    endpoint: `http://127.0.0.1:${port}/tts`,
    play: async (wav) => played.push(wav),
  });
  server.close();
  assert.equal(result.ok, false);
  assert.equal(played.length, 0);
  assert.match(result.error, /500/);
});
