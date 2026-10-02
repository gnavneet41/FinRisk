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

import { callGemini, DEFAULT_GEMINI_MODEL } from "./gemini.service.js";
import { callOpenAiCompatible } from "./openaiCompatible.service.js";

const TIMEOUT_MS = 60000;
// 429 = rate limited, 500 = internal error, 503 = overloaded, 504 = timeout
const RETRYABLE_STATUS = new Set([429, 500, 503, 504]);
const MAX_ATTEMPTS_PER_MODEL = 3;
const BASE_DELAY_MS = 2000; // 2s, then 4s

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------
// Configuration
// ------------------------------------------------------------

export function getLlmConfig() {
  const env = process.env;
  const provider = (env.LLM_PROVIDER || (env.GEMINI_API_KEY ? "gemini" : "none")).toLowerCase();

  if (provider === "gemini") {
    return {
      provider,
      models: [env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL].filter(Boolean),
      apiKey: env.GEMINI_API_KEY,
      configured: Boolean(env.GEMINI_API_KEY)
    };
  }

  if (provider === "openai_compatible") {
    return {
      provider,
      models: [env.LLM_MODEL].filter(Boolean),
      baseUrl: env.LLM_BASE_URL,
      apiKey: env.LLM_API_KEY,
      configured: Boolean(env.LLM_BASE_URL && env.LLM_MODEL)
    };
  }

  return { provider: "none", models: [], configured: false };
}

export function isFallbackEnabled() {
  return String(process.env.LLM_FALLBACK ?? "true").toLowerCase() !== "false";
}

/** Safe summary for /api/health (never includes keys). */
export function getLlmStatus() {
  const config = getLlmConfig();
  return {
    provider: config.provider,
    models: config.models,
    configured: config.configured,
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
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
      try {
        const text = await callProvider(config, model, prompt);
        return { data: parseJson(text), model, provider: config.provider };
      } catch (error) {
        lastError = error;
        const retryable = !error.status || RETRYABLE_STATUS.has(error.status);
        if (!retryable || error.invalidJson) throw error;

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
      return await callGemini({ model, prompt, apiKey: config.apiKey, timeoutMs: TIMEOUT_MS });
    }
    return await callOpenAiCompatible({
      baseUrl: config.baseUrl,
      model,
      prompt,
      apiKey: config.apiKey,
      timeoutMs: TIMEOUT_MS
    });
  } catch (error) {
    if (error.status) throw error;
    // Network failure / timeout (no HTTP status) — retryable.
    throw new Error(`Could not reach ${config.provider} (model ${model}): ${error.message}`);
  }
}

function parseJson(text) {
  if (!text) {
    const err = new Error("LLM returned an empty response");
    err.invalidJson = true;
    throw err;
  }
  // Some models wrap JSON in ```json fences — strip them.
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    console.error("LLM raw response:", text.slice(0, 1000));
    const err = new Error("LLM returned invalid JSON");
    err.invalidJson = true;
    throw err;
  }
}
