// ============================================================
// GEMINI PROVIDER
// ------------------------------------------------------------
// One HTTP call to the Gemini REST API. Retries and fallback
// are handled by llm.service.js, so this file stays small.
// The API key is sent in a header (not the URL).
// ============================================================

// gemini-2.5-flash is no longer available to new API keys.
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

/**
 * Returns { text, finishReason }.
 * maxOutputTokens leaves room for long JSON answers; thinking models count
 * their reasoning against it, so a low limit can cut the JSON off mid-way.
 */
export async function callGemini({ model, prompt, apiKey, timeoutMs, maxOutputTokens = 8192 }) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      // Gemini 3 models: Google says to remove temperature/top_p/top_k.
      // Output consistency is enforced by the validators in each agent.
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens
      }
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    const errorText = await response.text();
    const err = new Error(
      `Gemini API error ${response.status} (model ${model}): ${errorText.slice(0, 500)}`
    );
    err.status = response.status;
    throw err;
  }

  const result = await response.json();

  // Join every text part (Gemini 3 may split the answer and can add
  // "thought" parts, which are skipped).
  const candidate = result?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const text = parts
    .filter((part) => typeof part.text === "string" && !part.thought)
    .map((part) => part.text)
    .join("")
    .trim();
  return { text, finishReason: candidate?.finishReason ?? null };
}
