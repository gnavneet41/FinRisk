// ============================================================
// SYSTEM CONFIGURATION
// ------------------------------------------------------------
// Admin-editable settings, stored in MongoDB (SystemConfig) and
// cached in memory so every request does not hit the database.
// Defaults come from .env the first time.
// Secrets (API keys, JWT secret) are never stored here.
// ============================================================

import SystemConfig from "../models/SystemConfig.js";

export const FILE_TYPES = ["pdf", "docx", "csv", "xlsx"];
export const LLM_PROVIDERS = ["gemini", "openai_compatible", "none"];

function defaults() {
  const env = process.env;
  return {
    processing: {
      max_file_size_mb: 20,
      allowed_types: [...FILE_TYPES],
      auto_analyze: true,           // run the analysis straight after upload
      keep_uploaded_files: true     // false = delete the file after extraction
    },
    llm: {
      provider: (env.LLM_PROVIDER || (env.GEMINI_API_KEY ? "gemini" : "none")).toLowerCase(),
      gemini_model: env.GEMINI_MODEL || "gemini-3.8-flash",
      gemini_fallback_model: env.GEMINI_FALLBACK_MODEL || "",
      openai_base_url: env.LLM_BASE_URL || "",
      openai_model: env.LLM_MODEL || "",
      fallback_enabled: String(env.LLM_FALLBACK ?? "true").toLowerCase() !== "false",
      max_output_tokens: Number(env.GEMINI_MAX_OUTPUT_TOKENS) || 8192,
      timeout_seconds: 60
    },
    rag: {
      max_rule_entries: 15,         // curated rules given to the Risk Advisor
      max_document_chunks: 3,       // extra text chunks given to the Risk Advisor
      chat_top_k: 4,                // chunks retrieved per chat question
      chunk_size_chars: 900,        // chunk size for new knowledge documents
      include_company_knowledge: true
    }
  };
}

let cache = defaults();
// Only the settings the admin has changed are stored in MongoDB.
// Everything else keeps following .env, so editing .env still works.
let overrides = { processing: {}, llm: {}, rag: {} };

// ------------------------------------------------------------
// Validation rules per field: [type, extra check]
// ------------------------------------------------------------
const RULES = {
  processing: {
    max_file_size_mb: (v) => Number.isInteger(v) && v >= 1 && v <= 100,
    allowed_types: (v) => Array.isArray(v) && v.length > 0 && v.every((t) => FILE_TYPES.includes(t)),
    auto_analyze: (v) => typeof v === "boolean",
    keep_uploaded_files: (v) => typeof v === "boolean"
  },
  llm: {
    provider: (v) => LLM_PROVIDERS.includes(v),
    gemini_model: (v) => typeof v === "string" && /^[\w.-]{1,80}$/.test(v),
    gemini_fallback_model: (v) => typeof v === "string" && /^[\w.-]{0,80}$/.test(v),
    openai_base_url: (v) => typeof v === "string" && (v === "" || /^https?:\/\/\S+$/.test(v)),
    openai_model: (v) => typeof v === "string" && v.length <= 120,
    fallback_enabled: (v) => typeof v === "boolean",
    max_output_tokens: (v) => Number.isInteger(v) && v >= 1024 && v <= 65536,
    timeout_seconds: (v) => Number.isInteger(v) && v >= 10 && v <= 300
  },
  rag: {
    max_rule_entries: (v) => Number.isInteger(v) && v >= 1 && v <= 50,
    max_document_chunks: (v) => Number.isInteger(v) && v >= 0 && v <= 20,
    chat_top_k: (v) => Number.isInteger(v) && v >= 1 && v <= 20,
    chunk_size_chars: (v) => Number.isInteger(v) && v >= 200 && v <= 5000,
    include_company_knowledge: (v) => typeof v === "boolean"
  }
};

export async function loadSystemConfig() {
  let doc = await SystemConfig.findOne({ key: "system" }).lean();
  if (!doc) {
    await SystemConfig.create({ key: "system", processing: {}, llm: {}, rag: {} });
    doc = { processing: {}, llm: {}, rag: {} };
  }
  overrides = {
    processing: doc.processing ?? {},
    llm: doc.llm ?? {},
    rag: doc.rag ?? {}
  };
  return rebuildCache();
}

function rebuildCache() {
  const base = defaults();
  cache = {
    processing: { ...base.processing, ...overrides.processing },
    llm: { ...base.llm, ...overrides.llm },
    rag: { ...base.rag, ...overrides.rag }
  };
  return cache;
}

/** Which settings come from the admin (MongoDB) rather than .env / defaults. */
export function getOverriddenKeys() {
  return Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, Object.keys(v)]));
}

/** Synchronous read from the in-memory cache. */
export function getConfig(section) {
  return section ? cache[section] : cache;
}

/** Validates and saves a partial update of one section. */
export async function updateConfig(section, patch, userId) {
  const rules = RULES[section];
  if (!rules) throw Object.assign(new Error(`Unknown configuration section: ${section}`), { status: 400 });

  const clean = {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!rules[key]) throw Object.assign(new Error(`Unknown setting: ${section}.${key}`), { status: 400 });
    if (!rules[key](value)) throw Object.assign(new Error(`Invalid value for ${section}.${key}`), { status: 400 });
    clean[key] = value;
  }

  const nextOverrides = { ...overrides[section], ...clean };
  await SystemConfig.updateOne(
    { key: "system" },
    { $set: { [section]: nextOverrides, updated_by: userId ?? null } },
    { upsert: true }
  );
  overrides = { ...overrides, [section]: nextOverrides };
  rebuildCache();
  return cache[section];
}

/** Removes the admin's changes for a section, returning to .env / defaults. */
export async function resetConfigSection(section, userId) {
  if (!RULES[section]) throw Object.assign(new Error(`Unknown configuration section: ${section}`), { status: 400 });
  await SystemConfig.updateOne(
    { key: "system" },
    { $set: { [section]: {}, updated_by: userId ?? null } },
    { upsert: true }
  );
  overrides = { ...overrides, [section]: {} };
  rebuildCache();
  return cache[section];
}

/** Test helper: reset to defaults without a database. */
export function resetConfigCache() {
  overrides = { processing: {}, llm: {}, rag: {} };
  cache = defaults();
}
