import { createDesktop } from "./tools/desktop.js";

export const AGENT_MODEL = "grok-4.7";
export const MAX_ROUNDS = 8;

export const AGENT_PROMPT = `You control this Windows PC with the provided tools only.
Do not invent shell commands, file paths, or key chords that open the Run dialog.
launch_app takes an installed app's Start menu display name, never a path.
Closing a window uses close_window, not Alt+F4.
When the command is done, call finish with one or two spoken sentences.
If a tool fails, try another control once, then finish with a short failure.`;

const FUNCTION = (name, description, properties, required) => ({
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

export const DESKTOP_TOOL_DEFS = [
  FUNCTION("list_windows", "List visible top-level windows.", {}, []),
  FUNCTION(
    "launch_app",
    "Start an installed app by its Start menu display name.",
    { name: { type: "string" } },
    ["name"],
  ),
  FUNCTION(
    "focus_window",
    "Bring a window to the foreground by title or process name.",
    { title: { type: "string" }, name: { type: "string" } },
    [],
  ),
  FUNCTION(
    "inspect_window",
    "Return a short accessibility tree for a window.",
    { title: { type: "string" }, name: { type: "string" } },
    [],
  ),
  FUNCTION(
    "invoke_control",
    "Click a control by its accessible name.",
    { name: { type: "string" } },
    ["name"],
  ),
  FUNCTION(
    "set_text",
    "Set a named field, or type into the focused field when name is omitted.",
    { name: { type: "string" }, text: { type: "string" } },
    ["text"],
  ),
  FUNCTION(
    "press_keys",
    "Send an allowlisted shortcut.",
    { keys: { type: "string" } },
    ["keys"],
  ),
  FUNCTION(
    "read_text",
    "Read the text of a named control.",
    { name: { type: "string" } },
    ["name"],
  ),
  FUNCTION(
    "close_window",
    "Close a window. Always asks the user first.",
    { title: { type: "string" }, name: { type: "string" } },
    [],
  ),
  FUNCTION(
    "finish",
    "Stop and speak this sentence.",
    { text: { type: "string" } },
    ["text"],
  ),
];

export function twoSentences(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/(?<=[.!?])\s+/);
  return parts.slice(0, 2).join(" ");
}

function parseArgs(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || value.trim() === "") return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function extractTurn(response) {
  const output = Array.isArray(response?.output) ? response.output : [];
  const calls = output.filter((item) => item.type === "function_call");
  const message = output.find((item) => item.type === "message");
  let text = "";
  if (typeof message?.content === "string") text = message.content;
  else if (Array.isArray(message?.content)) {
    text = message.content.map((part) => part.text || "").join(" ");
  }
  return { calls, text: text.trim(), id: response?.id };
}

export async function runToolLoop({
  transcript,
  foregroundTitle = "",
  request,
  desktop,
  confirm,
  log,
  onStep,
  signal,
  maxRounds = MAX_ROUNDS,
  call,
}) {
  const tools =
    desktop ??
    createDesktop({
      call,
      log,
      onStep,
      confirm,
    });
  const dispatch = {
    list_windows: () => tools.list_windows(),
    launch_app: (args) => tools.launch_app(args),
    focus_window: (args) => tools.focus_window(args),
    inspect_window: (args) => tools.inspect_window(args),
    invoke_control: (args) => tools.invoke_control(args),
    set_text: (args) => tools.set_text(args),
    press_keys: (args) => tools.press_keys(args),
    read_text: (args) => tools.read_text(args),
    close_window: (args) => tools.close_window(args),
  };

  let body = {
    model: AGENT_MODEL,
    tools: DESKTOP_TOOL_DEFS,
    input: [
      { role: "system", content: AGENT_PROMPT },
      {
        role: "user",
        content: `Foreground window: ${foregroundTitle || "unknown"}\n\n${transcript}`,
      },
    ],
  };

  for (let round = 1; round <= maxRounds; round++) {
    if (signal?.aborted) {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }
    const response = await request(body);
    const turn = extractTurn(response);
    const finish = turn.calls.find((callItem) => callItem.name === "finish");
    if (finish) {
      const args = parseArgs(finish.arguments);
      return twoSentences(args.text || args.sentence || "") || "Done.";
    }
    if (turn.calls.length === 0) {
      return twoSentences(turn.text) || "I stopped before finishing.";
    }

    const results = await Promise.all(
      turn.calls.map(async (callItem) => {
        const args = parseArgs(callItem.arguments);
        const fn = dispatch[callItem.name];
        if (!fn) {
          return {
            call_id: callItem.call_id,
            output: JSON.stringify({ ok: false, error: `Unknown tool ${callItem.name}` }),
            cancelled: false,
          };
        }
        const result = await fn(args);
        return {
          call_id: callItem.call_id,
          output: JSON.stringify(result),
          cancelled: Boolean(result?.cancelled),
        };
      }),
    );
    if (results.some((result) => result.cancelled)) return "Cancelled.";
    if (round === maxRounds) return "I stopped before finishing.";

    body = {
      model: AGENT_MODEL,
      tools: DESKTOP_TOOL_DEFS,
      previous_response_id: turn.id,
      input: results.map((result) => ({
        type: "function_call_output",
        call_id: result.call_id,
        output: result.output,
      })),
    };
  }
  return "I stopped before finishing.";
}
