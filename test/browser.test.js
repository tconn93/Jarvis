import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserTools, googleSearchUrl, queryAddsPlace } from "../src/tools/browser.js";

test("checkout does nothing until the confirmer says yes", async () => {
  const calls = [];
  const blocked = createBrowserTools({
    connected: () => true,
    call: async (tool) => {
      calls.push(tool);
      return { ok: true, data: {} };
    },
    confirm: async () => false,
    log: { async append() {} },
  });
  const no = await blocked.browser_click({ name: "Checkout" });
  assert.equal(no.ok, false);
  assert.equal(no.cancelled, true);
  assert.equal(calls.length, 0);

  const allowed = createBrowserTools({
    connected: () => true,
    call: async (tool) => {
      calls.push(tool);
      return { ok: true, data: {} };
    },
    confirm: async () => true,
    log: { async append() {} },
  });
  const yes = await allowed.browser_click({ name: "Checkout" });
  assert.equal(yes.ok, true);
  assert.deepEqual(calls, ["browser_click"]);
});

test("a search that adds a place is not sent to the browser", async () => {
  const transcript = "google 5 star restaurants in town";
  const invented = googleSearchUrl("5 star restaurants in Pensacola");
  const spoken = googleSearchUrl("5 star restaurants in town");
  assert.equal(queryAddsPlace(transcript, invented), true);
  assert.equal(queryAddsPlace(transcript, spoken), false);
  const calls = [];
  const tools = createBrowserTools({
    transcript,
    connected: () => true,
    call: async (tool) => {
      calls.push(tool);
      return { ok: true, data: {} };
    },
    log: { async append() {} },
  });
  const blocked = await tools.browser_navigate({ url: invented });
  assert.equal(blocked.missingPlace, true);
  assert.equal(calls.length, 0);
  const ok = await tools.browser_navigate({ url: spoken });
  assert.equal(ok.ok, true);
});

test("cookies default to reject", async () => {
  let choice = "";
  const tools = createBrowserTools({
    connected: () => true,
    call: async (_tool, args) => {
      choice = args.choice;
      return { ok: true, data: {} };
    },
    log: { async append() {} },
  });
  await tools.browser_dismiss_cookies({});
  assert.equal(choice, "reject");
});

test("an explicit cookie choice beats the saved default", async () => {
  let choice = "";
  const tools = createBrowserTools({
    cookieChoice: "accept",
    connected: () => true,
    call: async (_tool, args) => {
      choice = args.choice;
      return { ok: true, data: {} };
    },
    log: { async append() {} },
  });
  await tools.browser_dismiss_cookies({ choice: "reject" });
  assert.equal(choice, "reject");
});
