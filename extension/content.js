function visible(element) {
  const style = getComputedStyle(element);
  if (style.visibility === "hidden" || style.display === "none") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

function labelOf(element) {
  return (
    element.getAttribute("aria-label") ||
    element.innerText ||
    element.value ||
    element.getAttribute("placeholder") ||
    element.getAttribute("title") ||
    element.getAttribute("name") ||
    ""
  ).trim();
}

function findByName(name) {
  const want = String(name || "").trim().toLowerCase();
  if (!want) return document.activeElement;
  const nodes = document.querySelectorAll("a, button, input, textarea, select, summary, label, [role], h1, h2, h3, p, span, div");
  let partial = null;
  for (const element of nodes) {
    if (!visible(element)) continue;
    const label = labelOf(element).toLowerCase();
    if (label === want) return element;
    if (!partial && label.includes(want)) partial = element;
  }
  return partial;
}

function requireElement(name) {
  const element = findByName(name);
  if (!element) throw new Error("no matching element");
  return element;
}

function typeInto(element, text) {
  element.focus();
  if ("value" in element) {
    element.value = text;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  element.textContent = text;
  element.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
}

const actions = {
  browser_click({ name }) {
    requireElement(name).click();
    return { name };
  },
  browser_hover({ name }) {
    const element = requireElement(name);
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    return { name };
  },
  browser_type({ name, text }) {
    typeInto(name ? requireElement(name) : document.activeElement, text ?? "");
    return { name: name || "" };
  },
  browser_press({ key }) {
    const target = document.activeElement || document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    if (key === "Enter") target.click?.();
    return { key };
  },
  browser_find({ text }) {
    const found = window.find?.(text) || false;
    if (!found) {
      const hit = [...document.querySelectorAll("body *")].find((element) =>
        (element.childNodes.length === 1 && element.textContent.includes(text)),
      );
      if (!hit) throw new Error("no matching element");
      hit.style.outline = "2px solid #d6e27a";
      hit.scrollIntoView({ block: "center" });
    }
    return { text };
  },
  browser_scroll({ name, direction }) {
    const element = name ? requireElement(name) : document.scrollingElement || document.body;
    const amount = direction === "up" ? -400 : 400;
    if (element === document.body || element === document.scrollingElement) window.scrollBy(0, amount);
    else element.scrollBy?.(0, amount);
    return { direction: direction || "down" };
  },
  browser_extract() {
    return { text: (document.body?.innerText || "").slice(0, 4000) };
  },
  browser_fill_form({ fields }) {
    for (const [name, value] of Object.entries(fields || {})) {
      typeInto(requireElement(name), value);
    }
    return { count: Object.keys(fields || {}).length };
  },
  browser_toggle({ name }) {
    const element = requireElement(name);
    if (element.tagName === "DETAILS") element.open = !element.open;
    else element.click();
    return { name };
  },
  browser_rich_text({ format }) {
    const command = { bold: "bold", italic: "italic", heading: "formatBlock", list: "insertUnorderedList" }[format];
    if (!command) throw new Error("Unknown format.");
    document.execCommand(command, false, format === "heading" ? "h2" : null);
    return { format };
  },
  async browser_copy() {
    document.execCommand("copy");
    return {};
  },
  async browser_paste() {
    const text = await navigator.clipboard.readText();
    typeInto(document.activeElement, text);
    return {};
  },
  browser_choose_file({ name }) {
    const element = name ? requireElement(name) : document.querySelector('input[type="file"]');
    if (!element) throw new Error("no matching element");
    element.focus();
    element.click();
    return { waiting: true };
  },
  browser_dismiss_cookies({ choice }) {
    const words = choice === "accept"
      ? ["accept", "allow", "agree", "got it"]
      : ["reject", "decline", "deny", "refuse", "necessary"];
    const buttons = [...document.querySelectorAll("button, [role='button'], a")].filter(visible);
    const match = buttons.find((button) => words.some((word) => labelOf(button).toLowerCase().includes(word)));
    if (!match) throw new Error("no matching element");
    match.click();
    return { choice: choice === "accept" ? "accept" : "reject" };
  },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "call") return false;
  const action = actions[message.tool];
  if (!action) {
    sendResponse({ ok: false, error: `Unknown browser tool ${message.tool}` });
    return false;
  }
  Promise.resolve()
    .then(() => action(message.args || {}))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
