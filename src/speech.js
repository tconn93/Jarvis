export const TTS_URL = "https://api.x.ai/v1/tts";

export async function synthesize({
  text,
  voiceId = "eve",
  apiKey,
  fetchImpl = fetch,
  endpoint = TTS_URL,
} = {}) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          voice_id: voiceId,
          language: "en",
          output_format: { codec: "wav", sample_rate: 24000 },
        }),
      });
      if (response.status >= 500) {
        lastError = new Error(`tts ${response.status}`);
        continue;
      }
      if (!response.ok) {
        return { ok: false, error: `tts ${response.status}` };
      }
      const wav = Buffer.from(await response.arrayBuffer());
      return { ok: true, wav };
    } catch (error) {
      lastError = error;
    }
  }
  return { ok: false, error: lastError?.message || "tts failed" };
}

export async function speak({ text, voiceId, apiKey, fetchImpl, play, endpoint }) {
  const result = await synthesize({ text, voiceId, apiKey, fetchImpl, endpoint });
  if (!result.ok) return result;
  await play(result.wav);
  return result;
}
