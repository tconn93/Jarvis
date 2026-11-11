import { isRiskyControl } from "./desktop.js";

const STOP = new Set([
  "a", "an", "the", "in", "on", "of", "for", "and", "to", "near", "me", "town",
  "google", "search", "find", "star", "stars",
]);

export const BROWSER_PROMPT = `Browser tools are available when the extension is connected.
Search by opening https://www.google.com/search?q= plus the encoded query the user spoke.
Do not add a city or any place the user did not say.
If a search needs a place and none was spoken, call finish and say the place was missing.
Login and verification codes are click and type only. Do not store a password.
If a page is waiting for a code, call finish and say you are waiting for them.
Cookie banners use the saved choice. The default is reject.
Do not click checkout, pay, send, or delete until the user has confirmed that single action.`;

const fn = (name, description, properties, required) => ({
  type: "function",
  name,
  description,
  parameters: {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  },
});

const str = { type: "string" };

export const BROWSER_TOOL_DEFS = [
  fn("browser_open_window", "Open a browser window. An optional URL loads in it.", { url: str }, []),
  fn("browser_open_tab", "Open a tab. An optional URL loads in it.", { url: str }, []),
  fn("browser_focus", "Focus a window or tab.", { tabId: { type: "number" }, windowId: { type: "number" }, title: str }, []),
  fn("browser_navigate", "Go to a URL in the current tab.", { url: str }, ["url"]),
  fn("browser_click", "Click an element by accessible name or visible text.", { name: str }, ["name"]),
  fn("browser_hover", "Hover an element by name or visible text.", { name: str }, ["name"]),
  fn("browser_type", "Type into the focused field or a named field.", { name: str, text: str }, ["text"]),
  fn("browser_press", "Send a key in the page.", { key: str }, ["key"]),
  fn("browser_find", "Highlight a phrase in the page.", { text: str }, ["text"]),
  fn("browser_scroll", "Scroll the page or a named region.", { name: str, direction: str }, []),
  fn("browser_extract", "Return visible text from the page, capped in size.", {}, []),
  fn("browser_fill_form", "Set named fields.", { fields: { type: "object", additionalProperties: { type: "string" } } }, ["fields"]),
  fn("browser_toggle", "Open or close a collapsible section.", { name: str }, ["name"]),
  fn("browser_rich_text", "Apply bold, italic, a heading, or a list in a contenteditable region.", { format: str }, ["format"]),
  fn("browser_copy", "Copy the current selection.", {}, []),
  fn("browser_paste", "Paste the clipboard into the focused field.", {}, []),
  fn("browser_choose_file", "Set a file input to a path the user already confirmed.", { name: str, path: str }, ["path"]),
  fn("browser_dismiss_cookies", "Dismiss a consent banner using the saved choice. Default is reject.", { choice: str }, []),
];

export function googleSearchUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(String(query ?? "").trim())}`;
}

export function queryAddsPlace(transcript, url) {
  let query = "";
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (!host.startsWith("google.") || !parsed.pathname.startsWith("/search")) return false;
    query = parsed.searchParams.get("q") || "";
  } catch {
    return false;
  }
  const spoken = new Set(
    String(transcript ?? "")
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter(Boolean),
  );
  const extra = query
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((word) => word && !spoken.has(word) && !STOP.has(word) && !/^\d+$/.test(word));
  return extra.length > 0;
}

function toolError(error, extra = {}) {
  return { ok: false, error, ...extra };
}

export function createBrowserTools({
  call,
  confirm,
  log,
  onStep,
  connected = () => true,
  transcript = "",
  cookieChoice = "reject",
}) {
  async function run(stepText, tool, args) {
    if (!connected()) return toolError("The browser is not connected.", { disconnected: true });
    if (log) await log.append("step", stepText);
    onStep?.(stepText);
    try {
      const result = await call(tool, args);
      if (!result || result.ok === false) {
        return toolError(result?.error || "The browser did not do that.");
      }
      return { ok: true, data: result.data ?? result };
    } catch (error) {
      return toolError(error.message || "The browser did not do that.");
    }
  }

  function guardUrl(url) {
    if (url && queryAddsPlace(transcript, url)) {
      return toolError("The place was missing.", { missingPlace: true });
    }
    return null;
  }

  async function risky(name, question) {
    if (!isRiskyControl(name)) return null;
    if (!confirm) return toolError("confirmation required");
    const yes = await confirm(question);
    if (!yes) return { ok: false, error: "Cancelled.", cancelled: true };
    return null;
  }

  return {
    browser_open_window(args = {}) {
      const blocked = guardUrl(args.url);
      if (blocked) return blocked;
      return run("Opened a browser window.", "browser_open_window", args);
    },
    browser_open_tab(args = {}) {
      const blocked = guardUrl(args.url);
      if (blocked) return blocked;
      return run("Opened a tab.", "browser_open_tab", args);
    },
    browser_focus(args = {}) {
      return run("Focused the browser.", "browser_focus", args);
    },
    browser_navigate(args = {}) {
      const blocked = guardUrl(args.url);
      if (blocked) return blocked;
      return run(`Opened ${args.url}.`, "browser_navigate", args);
    },
    async browser_click(args = {}) {
      const held = await risky(args.name, `${args.name}?`);
      if (held) return held;
      return run(`Clicked ${args.name}.`, "browser_click", args);
    },
    browser_hover(args = {}) {
      return run(`Hovered ${args.name}.`, "browser_hover", args);
    },
    browser_type(args = {}) {
      const label = args.name || "the focused field";
      return run(`Typed into ${label}.`, "browser_type", args);
    },
    browser_press(args = {}) {
      return run(`Pressed ${args.key}.`, "browser_press", args);
    },
    browser_find(args = {}) {
      return run(`Found ${args.text}.`, "browser_find", args);
    },
    browser_scroll(args = {}) {
      return run("Scrolled the page.", "browser_scroll", args);
    },
    browser_extract() {
      return run("Read the page.", "browser_extract", {});
    },
    browser_fill_form(args = {}) {
      return run("Filled the form.", "browser_fill_form", args);
    },
    async browser_toggle(args = {}) {
      const held = await risky(args.name, `${args.name}?`);
      if (held) return held;
      return run(`Toggled ${args.name}.`, "browser_toggle", args);
    },
    browser_rich_text(args = {}) {
      return run(`Applied ${args.format}.`, "browser_rich_text", args);
    },
    browser_copy() {
      return run("Copied the selection.", "browser_copy", {});
    },
    browser_paste() {
      return run("Pasted.", "browser_paste", {});
    },
    async browser_choose_file(args = {}) {
      if (!confirm) return toolError("confirmation required");
      const yes = await confirm(`Use ${args.path}?`);
      if (!yes) return { ok: false, error: "Cancelled.", cancelled: true };
      return run("Chose the file.", "browser_choose_file", args);
    },
    browser_dismiss_cookies(args = {}) {
      const requested = args.choice === "accept" || args.choice === "reject" ? args.choice : "";
      const choice = requested || (cookieChoice === "accept" ? "accept" : "reject");
      return run(
        choice === "accept" ? "Accepted cookies." : "Rejected cookies.",
        "browser_dismiss_cookies",
        { choice },
      );
    },
  };
}
