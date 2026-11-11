import assert from "node:assert/strict";
import test from "node:test";
import { decide } from "../src/gate.js";

function jsonResponse(text) {
  return {
    ok: true,
    async json() {
      return {
        output: [{ type: "message", content: [{ type: "output_text", text }] }],
      };
    },
  };
}

test("yes and no objects", async () => {
  const yes = await decide({
    transcript: "open notepad",
    apiKey: "test",
    fetchImpl: async () => jsonResponse('{"is_command":true,"reply":"Opening it."}'),
  });
  assert.equal(yes.is_command, true);
  const no = await decide({
    transcript: "how was your day",
    apiKey: "test",
    fetchImpl: async () => jsonResponse('{"is_command":false,"reply":"ignored"}'),
  });
  assert.deepEqual(no, { is_command: false, reply: "" });
});

test("malformed JSON and a timeout become no", async () => {
  const malformed = await decide({
    transcript: "open notepad",
    apiKey: "test",
    fetchImpl: async () => jsonResponse("not-json"),
  });
  assert.equal(malformed.is_command, false);

  const timedOut = await decide({
    transcript: "open notepad",
    apiKey: "test",
    fetchImpl: () =>
      new Promise((_resolve, reject) => {
        setTimeout(() => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        }, 20);
      }),
  });
  assert.equal(timedOut.is_command, false);
});
