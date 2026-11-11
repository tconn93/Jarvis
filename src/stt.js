import fs from "node:fs/promises";

export const STT_URL = "https://api.x.ai/v1/stt";
export const STT_MODEL = "grok-voice-transcribe-2.0";

export async function transcribeFile({
  filePath,
  apiKey,
  fetchImpl = fetch,
  readFile = (file) => fs.readFile(file),
  endpoint = STT_URL,
} = {}) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const bytes = await readFile(filePath);
      const body = new FormData();
      body.append("model", STT_MODEL);
      body.append("format", "true");
      body.append("language", "en");
      body.append("file", new Blob([bytes], { type: "audio/wav" }), "utterance.wav");
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body,
      });
      if (response.status >= 500) {
        lastError = new Error(`stt ${response.status}`);
        continue;
      }
      if (!response.ok) {
        const error = new Error(`stt ${response.status}`);
        error.retryable = false;
        throw error;
      }
      const json = await response.json();
      if (typeof json.text !== "string") throw new Error("stt response has no text");
      return json.text;
    } catch (error) {
      if (error.retryable === false) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new Error("stt failed");
}
