// ============================================================
// OPENAI-COMPATIBLE PROVIDER (for later use)
// ------------------------------------------------------------
// Many LLM services accept the same "chat completions" request
// format: Groq, OpenRouter, Together, a local Ollama server, etc.
// Set in .env:
//   LLM_PROVIDER=openai_compatible
//   LLM_BASE_URL=http://localhost:11434/v1     (example: Ollama)
//   LLM_MODEL=llama3.1
//   LLM_API_KEY=...                            (if the service needs one)
// ============================================================

export async function callOpenAiCompatible({ baseUrl, model, prompt, apiKey, timeoutMs }) {
  if (!baseUrl) throw new Error("LLM_BASE_URL is not configured");
  if (!model) throw new Error("LLM_MODEL is not configured");

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You reply with valid JSON only." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    const errorText = await response.text();
    const err = new Error(
      `LLM API error ${response.status} (model ${model}): ${errorText.slice(0, 500)}`
    );
    err.status = response.status;
    throw err;
  }

  const result = await response.json();
  return String(result?.choices?.[0]?.message?.content ?? "").trim();
}
