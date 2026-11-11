export const GATE_URL = "https://api.x.ai/v1/responses";
export const GATE_MODEL = "grok-4.7";

export const GATE_PROMPT = `You decide whether a transcript is a command for this computer.
Answer yes only when the words instruct the computer to do something: open or close a program, type, click, read the screen, or a similar action on this PC.
Answer no for conversation, background speech, questions aimed at a person, and a bare wake name with no instruction.
When the phrase is ambiguous, is_command is false.
reply is empty when is_command is false.`;

export function extractOutputText(payload) {
  const output = payload?.output;
  if (!Array.isArray(output)) {
    if (typeof payload?.text === "string") return payload.text;
    return "";
  }
  const message = output.find((item) => item.type === "message");
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((part) => part.text || "").join("");
  }
  return "";
}

export function parseGate(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { is_command: false, reply: "" };
  }
  if (!parsed || typeof parsed.is_command !== "boolean") {
    return { is_command: false, reply: "" };
  }
  if (!parsed.is_command) return { is_command: false, reply: "" };
  return {
    is_command: true,
    reply: typeof parsed.reply === "string" ? parsed.reply : "",
  };
}

export async function decide({
  transcript,
  apiKey,
  fetchImpl = fetch,
  timeoutMs = 20000,
  endpoint = GATE_URL,
} = {}) {
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GATE_MODEL,
        input: [
          { role: "system", content: GATE_PROMPT },
          { role: "user", content: String(transcript ?? "") },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "command_gate",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                is_command: { type: "boolean" },
                reply: { type: "string" },
              },
              required: ["is_command", "reply"],
            },
          },
        },
      }),
    });
    if (!response.ok) return { is_command: false, reply: "" };
    const json = await response.json();
    return parseGate(extractOutputText(json));
  } catch {
    return { is_command: false, reply: "" };
  }
}
