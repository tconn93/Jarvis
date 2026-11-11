const YES = /^(yes|yeah|yep)\b/i;
const NO = /^(no|nope|nah)\b/i;

export function interpretAnswer(text) {
  const trimmed = String(text ?? "").trim();
  if (YES.test(trimmed)) return true;
  if (NO.test(trimmed)) return false;
  return null;
}

export async function askConfirmation({
  question,
  speak,
  listen,
  button,
  timeoutMs = 15000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log,
} = {}) {
  if (log) await log.append("said", question);
  if (speak) await speak(question);

  const timeout = Promise.resolve(sleep(timeoutMs)).then(() => ({ source: "timeout" }));
  const voice = Promise.resolve(listen?.(timeoutMs)).then((text) => ({
    source: "voice",
    text: text ?? "",
  }));
  const click = Promise.resolve(button?.()).then((yes) => ({ source: "button", yes }));

  const winner = await Promise.race([timeout, voice, click]);
  if (winner.source === "button") return winner.yes === true;
  if (winner.source === "voice") {
    const answer = interpretAnswer(winner.text);
    return answer === true;
  }
  return false;
}
