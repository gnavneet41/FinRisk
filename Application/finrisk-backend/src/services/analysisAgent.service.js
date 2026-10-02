// ============================================================
// ANALYSIS AGENT
// ------------------------------------------------------------
// Decides WHAT should be analyzed (via Gemini).
// Never performs calculations itself — the Calculation Engine
// does the maths. Never assigns risk severity — that is the
// Risk Advisor's job.
// ============================================================

import {
  ANALYSIS_CATEGORIES,
  getCalculationCatalog,
  isKnownCalculation,
  toUsableNumber,
  executeCalculations,
  findUnavailableCalculations
} from "./calculationEngine.service.js";

import { generateJson, isFallbackEnabled } from "./llm.service.js";
import { buildRuleBasedPlan } from "./fallback.service.js";


// ============================================================
// ANALYSIS CAPABILITIES (shown to Gemini)
// ============================================================

const analysisCapabilities = [
  {
    key: "liquidity_analysis",
    name: "Liquidity Analysis",
    description: "Analyze the company's ability to meet short-term obligations."
  },
  {
    key: "solvency_analysis",
    name: "Solvency Analysis",
    description: "Analyze debt levels, liabilities and long-term financial structure."
  },
  {
    key: "profitability_analysis",
    name: "Profitability Analysis",
    description: "Analyze the company's ability to generate profit from revenue, assets and equity."
  },
  {
    key: "efficiency_analysis",
    name: "Efficiency Analysis",
    description: "Analyze how efficiently the company uses assets, inventory and receivables."
  },
  {
    key: "cash_flow_analysis",
    name: "Cash Flow Analysis",
    description: "Analyze operating cash generation and cash-flow coverage."
  },
  {
    key: "balance_sheet_analysis",
    name: "Balance Sheet Analysis",
    description: "Analyze assets, liabilities, equity and balance-sheet relationships."
  },
  {
    key: "income_statement_analysis",
    name: "Income Statement Analysis",
    description: "Analyze revenue, costs, gross profit, operating income and net income."
  },
  {
    key: "cash_flow_statement_analysis",
    name: "Cash Flow Statement Analysis",
    description: "Analyze operating, investing and financing cash flows."
  }
];

// Text fields that are allowed to be non-numeric.
const TEXT_FIELDS = new Set(["company", "fiscal_year"]);


// ============================================================
// PREPARE INPUT
// Splits extracted data into usable values and unavailable keys.
// null / undefined / "" / non-numeric values are NEVER used.
// ============================================================

export function prepareAnalysisInput(financialData) {
  const availableData = {};
  const unavailableKeys = [];

  for (const [key, value] of Object.entries(financialData)) {
    if (TEXT_FIELDS.has(key)) {
      if (typeof value === "string" && value.trim() !== "") {
        availableData[key] = value.trim();
      } else {
        unavailableKeys.push(key);
      }
      continue;
    }

    const number = toUsableNumber(value);
    if (number === null) {
      unavailableKeys.push(key);
    } else {
      availableData[key] = number;
    }
  }

  return { availableData, unavailableKeys };
}


// ============================================================
// BUILD PROMPT
// Only the small structured JSON is sent — never the PDF text.
// ============================================================

export function buildAnalysisPrompt(availableData, unavailableKeys) {
  const calculationCatalog = getCalculationCatalog().map(
    ({ key, name, category, description, required_keys }) => ({
      key,
      name,
      category,
      description,
      required_keys
    })
  );

  return `
You are the Analysis Agent in a financial risk assessment system.

ARCHITECTURE RULES:
1. The Document Agent has already extracted the values below. Do not invent values.
2. Do not use unavailable values. Do not estimate missing values.
3. Do NOT perform any mathematical calculation yourself. The Calculation Engine does that.
4. Select calculation keys ONLY from the AVAILABLE CALCULATION FUNCTIONS list.
5. Select category keys ONLY from the AVAILABLE ANALYSIS CATEGORIES list.
6. Do not assign risk levels, severity, ratings or a final risk classification.
   The Risk Advisor Agent does that later.

COMPANY: ${availableData.company ?? "Unavailable"}
FISCAL YEAR: ${availableData.fiscal_year ?? "Unavailable"}

AVAILABLE EXTRACTED FINANCIAL DATA:
${JSON.stringify(availableData, null, 2)}

UNAVAILABLE DATA KEYS:
${JSON.stringify(unavailableKeys)}

AVAILABLE CALCULATION FUNCTIONS:
${JSON.stringify(calculationCatalog, null, 2)}

AVAILABLE ANALYSIS CATEGORIES:
${JSON.stringify(analysisCapabilities, null, 2)}

YOUR TASK:
1. Select the analysis categories that are relevant for this document.
2. Select the calculation functions that are relevant and whose required_keys are all available.
3. List calculation functions that cannot be performed, with the missing keys.
4. Write factual observations about notable extracted values
   (e.g. sign of cash flows, relationships between reported totals).
   Each observation must reference ONE key from the available data.
   Do not compute new numbers in observations.

Return ONLY valid JSON in exactly this format:
{
  "analysis_categories": ["liquidity_analysis"],
  "selected_calculations": ["current_ratio"],
  "observations": [
    { "key": "operating_cash_flow", "value": "118254", "reason": "Operating activities generated positive cash flow." }
  ],
  "unavailable_calculations": [
    { "calculation": "interest_coverage", "missing_keys": ["interest_expense"] }
  ]
}
`.trim();
}


// ============================================================
// VALIDATE GEMINI'S PLAN
// Gemini output is untrusted: only known keys survive.
// ============================================================

export function validateAnalysisPlan(rawPlan, availableData) {
  if (!rawPlan || typeof rawPlan !== "object" || Array.isArray(rawPlan)) {
    throw new Error("Invalid analysis plan returned by Analysis Agent");
  }

  const asArray = (value) => (Array.isArray(value) ? value : []);
  const validCategoryKeys = new Set(ANALYSIS_CATEGORIES);

  // 1. Categories — must be known.
  const analysis_categories = [
    ...new Set(asArray(rawPlan.analysis_categories))
  ].filter((key) => validCategoryKeys.has(key));

  // 2. Calculations — must be known. Unknown ones are reported, not run.
  const selected_calculations = [];
  const rejected_calculations = [];
  for (const key of new Set(asArray(rawPlan.selected_calculations))) {
    if (isKnownCalculation(key)) {
      selected_calculations.push(key);
    } else {
      rejected_calculations.push({
        calculation: String(key),
        reason: "Unknown calculation function"
      });
    }
  }

  // 3. Observations — must point at a real extracted key.
  //    The value is ALWAYS replaced with the extracted value, so the
  //    LLM can never introduce a number that is not in the document.
  //    Any severity/risk fields Gemini adds are dropped.
  const observations = [];
  for (const obs of asArray(rawPlan.observations)) {
    if (!obs || typeof obs !== "object") continue;
    if (!Object.hasOwn(availableData, obs.key)) continue;
    if (typeof obs.reason !== "string" || obs.reason.trim() === "") continue;

    observations.push({
      key: obs.key,
      value: String(availableData[obs.key]),
      reason: obs.reason.trim()
    });
  }

  // 4. Gemini's view of unavailable calculations (kept for transparency;
  //    the authoritative list comes from the Calculation Engine).
  const unavailable_calculations = asArray(rawPlan.unavailable_calculations)
    .filter((item) => item && isKnownCalculation(item.calculation))
    .map((item) => ({
      calculation: item.calculation,
      missing_keys: asArray(item.missing_keys).map(String)
    }));

  return {
    analysis_categories,
    selected_calculations,
    observations,
    unavailable_calculations,
    rejected_calculations
  };
}


// ============================================================
// RUN ANALYSIS AGENT  (one LLM call, rule-based fallback)
// ============================================================

export async function runAnalysisAgent(financialData) {
  const { availableData, unavailableKeys } = prepareAnalysisInput(financialData);

  const prompt = buildAnalysisPrompt(availableData, unavailableKeys);
  console.log(`[Analysis Agent] Sending prompt to LLM (${prompt.length} chars)`);

  try {
    const { data, model, provider } = await generateJson(prompt, { label: "Analysis Agent" });
    const plan = validateAnalysisPlan(data, availableData);
    return { ...plan, generated_by: { method: "llm", provider, model } };
  } catch (error) {
    if (!isFallbackEnabled()) throw error;

    console.warn(`[Analysis Agent] LLM unavailable, using rule-based plan: ${error.message}`);
    return {
      ...buildRuleBasedPlan(availableData),
      generated_by: { method: "rule_based", llm_error: error.message }
    };
  }
}


// ============================================================
// EXECUTE ANALYSIS PLAN  (no LLM — Calculation Engine only)
// ============================================================

export function executeAnalysisPlan(financialData, analysisPlan) {
  const { availableData, unavailableKeys } = prepareAnalysisInput(financialData);

  const { calculated_ratios, unavailable_calculations: selectedButUnavailable } =
    executeCalculations(analysisPlan.selected_calculations, availableData);

  // Deterministic list of every known calculation that cannot run on
  // this data (e.g. interest_coverage needs interest_expense).
  const unavailable_calculations = findUnavailableCalculations(availableData);

  // Safety: anything selected but unavailable is already in the list
  // above; this keeps the lists consistent if the engine ever changes.
  for (const item of selectedButUnavailable) {
    if (!unavailable_calculations.some((u) => u.calculation === item.calculation)) {
      unavailable_calculations.push(item);
    }
  }

  return {
    company: availableData.company ?? null,
    fiscal_year: availableData.fiscal_year ?? null,
    available_data: availableData,
    unavailable_keys: unavailableKeys,
    analysis_categories: analysisPlan.analysis_categories,
    observations: analysisPlan.observations,
    calculated_ratios,
    unavailable_calculations
  };
}
