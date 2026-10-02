// ============================================================
// LLM SERVICE — the ONLY place agents talk to an LLM
// ------------------------------------------------------------
// Agents call generateJson(prompt). This file decides which
// provider to use, retries temporary failures, and parses JSON.
//
// .env options:
//   LLM_PROVIDER=gemini | openai_compatible | none
//       (default: gemini if GEMINI_API_KEY is set, otherwise none)
//   GEMINI_API_KEY=...
//   GEMINI_MODEL=gemini-3.8-flash          (optional)
//   GEMINI_FALLBACK_MODEL=...              (optional)
//   LLM_BASE_URL / LLM_MODEL / LLM_API_KEY (openai_compatible)
//   LLM_FALLBACK=true | false
//       true (default): if the LLM fails, agents use their
//       rule-based fallback so the app keeps working.
//
// Switching provider later = change .env, no agent code changes.
// ============================================================

import { callGemini } from "./gemini.service.js";
import { callOpenAiCompatible } from "./openaiCompatible.service.js";
import { getConfig } from "./systemConfig.service.js";
import { logEvent } from "./monitoring.service.js";

// 429 = rate limited, 500 = internal error, 503 = overloaded, 504 = timeout
const RETRYABLE_STATUS = new Set([429, 500, 503, 504]);
const MAX_ATTEMPTS_PER_MODEL = 3;
const BASE_DELAY_MS = 2000; // 2s, then 4s
// LLM output varies between calls, so an unusable JSON answer is
// asked for again once before giving up.
const MAX_INVALID_JSON_ATTEMPTS = 2;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------
// Configuration
// ------------------------------------------------------------

// Non-secret settings come from the admin's LLM configuration
// (MongoDB, defaults from .env). API keys only ever come from .env.
export function getLlmConfig() {
  const env = process.env;
  const c = getConfig("llm");
  const provider = c.provider;
  const common = { timeoutMs: c.timeout_seconds * 1000, maxOutputTokens: c.max_output_tokens };

  if (provider === "gemini") {
    return {
      ...common,
      provider,
      models: [c.gemini_model, c.gemini_fallback_model].filter(Boolean),
      apiKey: env.GEMINI_API_KEY,
      configured: Boolean(env.GEMINI_API_KEY && c.gemini_model)
    };
  }

  if (provider === "openai_compatible") {
    return {
      ...common,
      provider,
      models: [c.openai_model].filter(Boolean),
      baseUrl: c.openai_base_url,
      apiKey: env.LLM_API_KEY,
      configured: Boolean(c.openai_base_url && c.openai_model)
    };
  }

  return { ...common, provider: "none", models: [], configured: false };
}

export function isFallbackEnabled() {
  return getConfig("llm").fallback_enabled;
}

/** Safe summary for /api/health (never includes keys). */
export function getLlmStatus() {
  const config = getLlmConfig();
  return {
    provider: config.provider,
    models: config.models,
    configured: config.configured,
    api_key_present: config.provider === "gemini"
      ? Boolean(process.env.GEMINI_API_KEY)
      : config.provider === "openai_compatible" ? Boolean(process.env.LLM_API_KEY) : false,
    fallback_enabled: isFallbackEnabled()
  };
}

// ------------------------------------------------------------
// Main entry point
// ------------------------------------------------------------

/**
 * Sends a prompt to the configured LLM and returns parsed JSON
 * plus which model answered: { data, model, provider }.
 * Throws if the LLM is not configured or keeps failing.
 */
export async function generateJson(prompt, { label = "LLM" } = {}) {
  const config = getLlmConfig();

  if (!config.configured) {
    throw new Error(
      config.provider === "none"
        ? "No LLM configured (set GEMINI_API_KEY or LLM_PROVIDER in .env)"
        : `LLM provider '${config.provider}' is missing settings in .env`
    );
  }

  let lastError;

  for (const model of config.models) {
    let invalidJsonCount = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
      const started = Date.now();
      try {
        const { text, finishReason } = await callProvider(config, model, prompt);
        const data = parseJson(text, finishReason, label);
        logLlmCall(label, model, "success", started);
        return { data, model, provider: config.provider };
      } catch (error) {
        lastError = error;
        logLlmCall(label, model, error.invalidJson ? "invalid_json" : `error ${error.status ?? "network"}`, started, error);

        if (error.invalidJson) {
          invalidJsonCount++;
          if (invalidJsonCount >= MAX_INVALID_JSON_ATTEMPTS) throw error;
          console.warn(`[${label}] ${model}: ${error.message}. Asking again...`);
          continue; // retry immediately, no delay needed
        }

        const retryable = !error.status || RETRYABLE_STATUS.has(error.status);
        if (!retryable) throw error;

        if (attempt < MAX_ATTEMPTS_PER_MODEL) {
          const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
          console.warn(
            `[${label}] ${model} attempt ${attempt} failed (${error.status ?? error.message}). ` +
            `Retrying in ${delay / 1000}s...`
          );
          await sleep(delay);
        }
      }
    }
    console.warn(`[${label}] ${model} unavailable after ${MAX_ATTEMPTS_PER_MODEL} attempts.`);
  }

  throw lastError;
}

async function callProvider(config, model, prompt) {
  try {
    if (config.provider === "gemini") {
      return await callGemini({
        model, prompt, apiKey: config.apiKey,
        timeoutMs: config.timeoutMs, maxOutputTokens: config.maxOutputTokens
      });
    }
    return await callOpenAiCompatible({
      baseUrl: config.baseUrl,
      model,
      prompt,
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs
    });
  } catch (error) {
    if (error.status) throw error;
    // Network failure / timeout (no HTTP status) — retryable.
    throw new Error(`Could not reach ${config.provider} (model ${model}): ${error.message}`);
  }
}

function logLlmCall(agent, model, outcome, started, error = null) {
  logEvent("llm_call", `${agent}: ${outcome}`, {
    level: outcome === "success" ? "info" : "warning",
    meta: {
      agent,
      model,
      outcome,
      latency_ms: Date.now() - started,
      error: error ? error.message.slice(0, 300) : undefined
    }
  });
}

// ------------------------------------------------------------
// JSON parsing
// ------------------------------------------------------------

function invalidJson(message) {
  const err = new Error(message);
  err.invalidJson = true;
  return err;
}

/**
 * Parses the model's answer. Tolerates the common harmless problems:
 *   - ```json code fences
 *   - text before or after the JSON object
 *   - trailing commas before } or ]
 * A cut-off answer (token limit) cannot be repaired safely and is rejected.
 */
export function parseJson(text, finishReason = null, label = "LLM") {
  if (!text) throw invalidJson("LLM returned an empty response");

  const candidates = [];
  const unfenced = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  candidates.push(unfenced);

  const extracted = extractFirstJsonObject(unfenced);
  if (extracted) {
    candidates.push(extracted);
    candidates.push(extracted.replace(/,\s*([}\]])/g, "$1")); // trailing commas
  }

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object") return value;
    } catch {
      // try the next candidate
    }
  }

  // An opening { that never closes means the answer stopped mid-way.
  const cutOff = finishReason === "MAX_TOKENS" || (unfenced.includes("{") && !extracted);
  console.error(
    `[${label}] Unusable LLM response (${text.length} chars, finishReason ${finishReason ?? "unknown"}).\n` +
    `  Start: ${text.slice(0, 200).replace(/\s+/g, " ")}\n` +
    `  End:   ${text.slice(-200).replace(/\s+/g, " ")}`
  );
  throw invalidJson(
    cutOff
      ? "LLM response was cut off before the JSON was complete"
      : "LLM returned invalid JSON"
  );
}

/** Returns the first complete {...} block, respecting strings, or null. */
function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null; // never closed: the answer was cut off
}
