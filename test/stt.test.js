import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { transcribeFile } from "../src/stt.js";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

test("posts model, format, and language before the file and retries a drop", async () => {
  let hits = 0;
  let ordered = "";
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      hits += 1;
      const raw = Buffer.concat(chunks).toString("latin1");
      if (hits === 1) {
        req.socket.destroy();
        return;
      }
      ordered = raw;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ text: "open notepad" }));
    });
  });
  const port = await listen(server);
  const text = await transcribeFile({
    filePath: "clip.wav",
    apiKey: "test-key",
    endpoint: `http://127.0.0.1:${port}/stt`,
    readFile: async () => Buffer.from("RIFF-fake"),
  });
  server.close();
  assert.equal(text, "open notepad");
  assert.equal(hits, 2);
  const model = ordered.indexOf('name="model"');
  const format = ordered.indexOf('name="format"');
  const language = ordered.indexOf('name="language"');
  const file = ordered.indexOf('name="file"');
  assert.ok(model >= 0 && model < format && format < language && language < file);
});
