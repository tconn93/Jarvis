export function isStopPhrase(text, name) {
  let trimmed = String(text ?? "").trim();
  if (name && trimmed.toLowerCase().startsWith(String(name).toLowerCase())) {
    trimmed = trimmed.slice(name.length).trim().replace(/^[,:\-]+/, "").trim();
  }
  return /^(stop|cancel)\b/i.test(trimmed);
}

export function createLoop({
  transcribe,
  decide,
  runAgent,
  speak,
  log,
  deleteClip,
  name = "",
  onState,
} = {}) {
  let status = "listening";
  let muted = false;
  let busy = false;
  let paused = false;
  let abort = null;
  let now = [];
  let lastSaid = "";

  function state() {
    return {
      status: muted && status === "listening" ? "muted" : status,
      muted,
      paused,
      now: now.slice(),
      lastSaid,
    };
  }

  function setStatus(next) {
    status = next;
    onState?.(state());
  }

  async function handleClip({ wavPath }) {
    if (muted || (paused && !busy)) {
      await deleteClip(wavPath);
      return state();
    }

    if (busy) {
      let text = "";
      try {
        text = await transcribe(wavPath);
      } catch {
        text = "";
      }
      if (isStopPhrase(text, name)) abort?.abort();
      await deleteClip(wavPath);
      return state();
    }

    busy = true;
    abort = new AbortController();
    setStatus("deciding");
    let text = "";
    try {
      text = await transcribe(wavPath);
    } catch {
      await deleteClip(wavPath);
      if (log) await log.append("error", "Network failed before the command was accepted.");
      busy = false;
      abort = null;
      setStatus("offline");
      return state();
    }

    let gate;
    try {
      gate = await decide(text);
    } catch {
      gate = { is_command: false, reply: "" };
    }
    if (!gate?.is_command) {
      await deleteClip(wavPath);
      busy = false;
      abort = null;
      setStatus(muted ? "muted" : "listening");
      return state();
    }

    if (log) await log.append("heard", text);
    now = [];
    setStatus("working");
    let line = "";
    try {
      line = await runAgent({
        transcript: text,
        signal: abort.signal,
        onStep(step) {
          now.push(step);
          onState?.(state());
        },
      });
    } catch (error) {
      if (error?.name === "AbortError" || abort.signal.aborted) {
        line = "I stopped.";
      } else {
        line = "That did not work.";
        if (log) await log.append("error", error.message || "The command failed.");
      }
    }

    setStatus("speaking");
    paused = true;
    onState?.(state());
    try {
      await speak(line);
    } catch {
      /* The line stays on the status and in the log. */
    }
    if (log) await log.append("said", line);
    lastSaid = line;
    await deleteClip(wavPath);
    paused = false;
    busy = false;
    abort = null;
    setStatus(muted ? "muted" : "listening");
    return state();
  }

  return {
    state,
    isCapturePaused: () => paused,
    async setMuted(next) {
      muted = Boolean(next);
      if (!busy) setStatus(muted ? "muted" : "listening");
      else onState?.(state());
      return state();
    },
    stop() {
      abort?.abort();
    },
    handleClip,
  };
}
