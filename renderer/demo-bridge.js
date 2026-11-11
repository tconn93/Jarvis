if (window.surf || !new URLSearchParams(location.search).has("demo")) {
  /* Electron preload already installed the bridge. */
} else {
  document.body.classList.add("demo");

  const NAME = /^[A-Za-z0-9']+(?: [A-Za-z0-9']+)*$/;
  const COMMAND = /^(open|launch|start|type|write|click|press|close|focus|read)\b/i;
  let state = {
    status: "needs setup",
    name: "",
    voiceId: "eve",
    muted: false,
    expanded: false,
    now: [],
    log: [],
    confirm: null,
    error: "",
    play: null,
    browser: { connected: false, code: "", port: 47321 },
  };
  let key = "";
  const listeners = new Set();
  let confirmResolve = null;
  let working = false;
  let lastApp = "Notepad";

  function appName(phrase, pattern) {
    const match = phrase.match(pattern);
    if (!match) return lastApp;
    const name = match[1].replace(/[.?!]+$/, "").trim();
    return name || lastApp;
  }

  function emit() {
    const snapshot = {
      ...state,
      now: state.now.slice(),
      log: state.log.slice(),
      confirm: state.confirm ? { ...state.confirm } : null,
    };
    for (const fn of listeners) fn(snapshot);
  }

  function stamp(kind, text) {
    state.log = state.log.concat({ at: new Date().toISOString(), kind, text }).slice(-200);
  }

  function validate(name) {
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 32 || !NAME.test(trimmed)) {
      return "Use 2–32 letters, numbers, spaces, or apostrophes.";
    }
    return "";
  }

  function stripName(text) {
    const source = text.trim();
    if (state.name && source.toLowerCase().startsWith(state.name.toLowerCase())) {
      return source.slice(state.name.length).replace(/^[,:\s-]+/, "").trim();
    }
    return source;
  }

  async function runPhrase(raw) {
    if (state.status === "needs setup" || state.muted || working) return;
    const phrase = stripName(raw);
    if (!phrase) return;
    state.status = "hearing";
    emit();
    await wait(280);
    state.status = "deciding";
    emit();
    await wait(280);
    if (!COMMAND.test(phrase)) {
      state.status = state.muted ? "muted" : "listening";
      emit();
      return;
    }
    stamp("heard", phrase);
    state.now = [];
    state.status = "working";
    working = true;
    emit();
    if (/^close\b/i.test(phrase)) {
      const app = appName(phrase, /^close\s+(.+)/i);
      state.status = "waiting for yes";
      state.confirm = { question: `Close ${app}?` };
      stamp("said", `Close ${app}?`);
      emit();
      const yes = await new Promise((resolve) => {
        confirmResolve = resolve;
      });
      state.confirm = null;
      working = false;
      if (!yes) {
        stamp("said", "Cancelled.");
        state.status = "speaking";
        emit();
        await wait(400);
        state.status = "listening";
        emit();
        return;
      }
      state.now = [`Closed ${app}.`];
      stamp("step", `Closed ${app}.`);
      stamp("said", `Closed ${app}.`);
      state.status = "listening";
      emit();
      return;
    }
    const typed = /^type\b/i.test(phrase);
    const app = appName(phrase, /^(?:open|launch|start)\s+(.+)/i);
    if (!typed) lastApp = app;
    const step = typed
      ? `Typed ${phrase.replace(/^type\s+/i, "") || "the text"}.`
      : `Launched ${app}.`;
    state.now = [step];
    stamp("step", step);
    emit();
    await wait(700);
    if (!working) return;
    const said = typed ? "Typed that." : `Opened ${app}.`;
    stamp("said", said);
    working = false;
    state.status = "speaking";
    emit();
    await wait(350);
    state.status = state.muted ? "muted" : "listening";
    emit();
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  window.surf = {
    async getState() {
      return state;
    },
    onState(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async submitSetup({ name, apiKey }) {
      const error = validate(name || "");
      if (error) {
        state.error = error;
        emit();
        return state;
      }
      if (!apiKey || !String(apiKey).trim()) {
        state.error = "API key is required.";
        emit();
        return state;
      }
      key = String(apiKey);
      state.name = name.trim();
      state.error = "";
      state.status = "listening";
      state.expanded = false;
      emit();
      return state;
    },
    async setMuted(muted) {
      state.muted = Boolean(muted);
      if (!working) state.status = state.muted ? "muted" : "listening";
      emit();
    },
    async setExpanded(expanded) {
      state.expanded = Boolean(expanded);
      emit();
    },
    async stop() {
      if (!working && state.status !== "waiting for yes") return;
      working = false;
      if (confirmResolve) {
        confirmResolve(false);
        confirmResolve = null;
      }
      state.confirm = null;
      stamp("said", "I stopped.");
      state.status = state.muted ? "muted" : "listening";
      emit();
    },
    async confirm(yes) {
      if (confirmResolve) {
        const resolve = confirmResolve;
        confirmResolve = null;
        resolve(Boolean(yes));
      }
    },
    async rename(name) {
      const error = validate(name || "");
      if (error) {
        state.error = error;
        emit();
        return;
      }
      state.name = name.trim();
      state.error = "";
      emit();
    },
    async setVoice(voice) {
      state.voiceId = String(voice || "eve").trim() || "eve";
      emit();
    },
    async pairBrowser() {
      state.browser = { connected: false, code: "4F7K2M", port: 47321 };
      emit();
    },
    async disconnectBrowser() {
      state.browser = { connected: false, code: "", port: 47321 };
      emit();
    },
    async quit() {},
    phrase: runPhrase,
  };

  window.addEventListener("message", (event) => {
    if (event.data?.type === "surf-phrase") window.surf.phrase(event.data.text || "");
  });

  void key;
}
