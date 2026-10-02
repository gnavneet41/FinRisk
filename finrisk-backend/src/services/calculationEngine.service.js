/**
 * Calculation Engine
 * ------------------
 * Deterministic financial formulas.
 *
 * Rules:
 *  - Never calls the LLM.
 *  - Never invents, estimates or defaults a missing value.
 *  - Only runs calculations that are defined in CALCULATIONS below.
 *  - Returns both calculated results and calculations that could not run.
 */

const RATIO = "ratio"; // plain ratio, 4 decimals
const PERCENT = "percent"; // percentage, 2 decimals
const TIMES = "times"; // turnover / coverage multiple, 4 decimals

export const ANALYSIS_CATEGORIES = [
  "liquidity_analysis",
  "solvency_analysis",
  "profitability_analysis",
  "efficiency_analysis",
  "cash_flow_analysis",
  "balance_sheet_analysis",
  "income_statement_analysis",
  "cash_flow_statement_analysis"
];

// Every calculation the backend is allowed to execute.
// The LLM can only REFER to these keys; it can never add new ones.
const CALCULATIONS = Object.freeze({
  current_ratio: {
    key: "current_ratio",
    name: "Current Ratio",
    category: "liquidity_analysis",
    unit: RATIO,
    description: "Ability to cover current liabilities with current assets.",
    required_keys: ["current_assets", "current_liabilities"],
    formula: "current_assets / current_liabilities",
    calculate: (d) => d.current_assets / d.current_liabilities
  },

  quick_ratio: {
    key: "quick_ratio",
    name: "Quick Ratio",
    category: "liquidity_analysis",
    unit: RATIO,
    description: "Ability to cover current liabilities with liquid assets, excluding inventory.",
    required_keys: ["cash", "short_term_investments", "accounts_receivable", "current_liabilities"],
    formula: "(cash + short_term_investments + accounts_receivable) / current_liabilities",
    calculate: (d) =>
      (d.cash + d.short_term_investments + d.accounts_receivable) / d.current_liabilities
  },

  cash_ratio: {
    key: "cash_ratio",
    name: "Cash Ratio",
    category: "liquidity_analysis",
    unit: RATIO,
    description: "Ability to cover current liabilities with cash and short-term investments only.",
    required_keys: ["cash", "short_term_investments", "current_liabilities"],
    formula: "(cash + short_term_investments) / current_liabilities",
    calculate: (d) => (d.cash + d.short_term_investments) / d.current_liabilities
  },

  debt_to_equity: {
    key: "debt_to_equity",
    name: "Debt-to-Equity",
    category: "solvency_analysis",
    unit: RATIO,
    description: "Total debt relative to shareholders' equity.",
    required_keys: ["total_debt", "total_equity"],
    formula: "total_debt / total_equity",
    calculate: (d) => d.total_debt / d.total_equity
  },

  debt_ratio: {
    key: "debt_ratio",
    name: "Debt Ratio",
    category: "solvency_analysis",
    unit: RATIO,
    description: "Share of total assets financed by debt.",
    required_keys: ["total_debt", "total_assets"],
    formula: "total_debt / total_assets",
    calculate: (d) => d.total_debt / d.total_assets
  },

  liabilities_to_assets: {
    key: "liabilities_to_assets",
    name: "Liabilities-to-Assets",
    category: "solvency_analysis",
    unit: RATIO,
    description: "Share of total assets financed by all liabilities.",
    required_keys: ["total_liabilities", "total_assets"],
    formula: "total_liabilities / total_assets",
    calculate: (d) => d.total_liabilities / d.total_assets
  },

  gross_margin: {
    key: "gross_margin",
    name: "Gross Margin",
    category: "profitability_analysis",
    unit: PERCENT,
    description: "Gross profit as a percentage of revenue.",
    required_keys: ["gross_profit", "revenue"],
    formula: "(gross_profit / revenue) * 100",
    calculate: (d) => (d.gross_profit / d.revenue) * 100
  },

  operating_margin: {
    key: "operating_margin",
    name: "Operating Margin",
    category: "profitability_analysis",
    unit: PERCENT,
    description: "Operating income as a percentage of revenue.",
    required_keys: ["operating_income", "revenue"],
    formula: "(operating_income / revenue) * 100",
    calculate: (d) => (d.operating_income / d.revenue) * 100
  },

  net_profit_margin: {
    key: "net_profit_margin",
    name: "Net Profit Margin",
    category: "profitability_analysis",
    unit: PERCENT,
    description: "Net income as a percentage of revenue.",
    required_keys: ["net_income", "revenue"],
    formula: "(net_income / revenue) * 100",
    calculate: (d) => (d.net_income / d.revenue) * 100
  },

  return_on_assets: {
    key: "return_on_assets",
    name: "Return on Assets",
    category: "profitability_analysis",
    unit: PERCENT,
    description: "Net income relative to period-end total assets.",
    required_keys: ["net_income", "total_assets"],
    formula: "(net_income / total_assets) * 100",
    calculate: (d) => (d.net_income / d.total_assets) * 100
  },

  return_on_equity: {
    key: "return_on_equity",
    name: "Return on Equity",
    category: "profitability_analysis",
    unit: PERCENT,
    description: "Net income relative to period-end shareholders' equity.",
    required_keys: ["net_income", "total_equity"],
    formula: "(net_income / total_equity) * 100",
    calculate: (d) => (d.net_income / d.total_equity) * 100
  },

  asset_turnover: {
    key: "asset_turnover",
    name: "Asset Turnover",
    category: "efficiency_analysis",
    unit: TIMES,
    description: "Revenue generated per unit of period-end total assets.",
    required_keys: ["revenue", "total_assets"],
    formula: "revenue / total_assets",
    calculate: (d) => d.revenue / d.total_assets
  },

  inventory_turnover: {
    key: "inventory_turnover",
    name: "Inventory Turnover",
    category: "efficiency_analysis",
    unit: TIMES,
    description: "How many times period-end inventory is turned over by cost of sales.",
    required_keys: ["cost_of_goods_sold", "inventory"],
    formula: "cost_of_goods_sold / inventory",
    calculate: (d) => d.cost_of_goods_sold / d.inventory
  },

  receivables_turnover: {
    key: "receivables_turnover",
    name: "Receivables Turnover",
    category: "efficiency_analysis",
    unit: TIMES,
    description: "How many times period-end receivables are collected relative to revenue.",
    required_keys: ["revenue", "accounts_receivable"],
    formula: "revenue / accounts_receivable",
    calculate: (d) => d.revenue / d.accounts_receivable
  },

  cfo_to_current_liabilities: {
    key: "cfo_to_current_liabilities",
    name: "CFO / Current Liabilities",
    category: "cash_flow_analysis",
    unit: RATIO,
    description: "Operating cash flow relative to current liabilities.",
    required_keys: ["operating_cash_flow", "current_liabilities"],
    formula: "operating_cash_flow / current_liabilities",
    calculate: (d) => d.operating_cash_flow / d.current_liabilities
  },

  // Included so the engine demonstrates the "missing value" rule:
  // the Apple test report does not disclose interest_expense, so this
  // calculation is always reported as unavailable — never estimated.
  interest_coverage: {
    key: "interest_coverage",
    name: "Interest Coverage",
    category: "solvency_analysis",
    unit: TIMES,
    description: "Operating income relative to interest expense.",
    required_keys: ["operating_income", "interest_expense"],
    formula: "operating_income / interest_expense",
    calculate: (d) => d.operating_income / d.interest_expense
  }
});

// ---------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------

/**
 * Converts an extracted value to a number, or returns null if it is
 * missing / empty / not a clean number. Never guesses.
 */
export function toUsableNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  }
  return null; // null, undefined, "", "not disclosed", objects, etc.
}

function roundForUnit(value, unit) {
  const decimals = unit === PERCENT ? 2 : 4;
  return Number(value.toFixed(decimals));
}

// ---------------------------------------------------------------
// Catalog / lookup
// ---------------------------------------------------------------

/**
 * Security check: only keys that are OWN properties of CALCULATIONS
 * are valid. This blocks names like "__proto__" or "constructor".
 */
export function isKnownCalculation(key) {
  return typeof key === "string" && Object.hasOwn(CALCULATIONS, key);
}

/** Calculation metadata for prompts and API responses (no functions). */
export function getCalculationCatalog() {
  return Object.values(CALCULATIONS).map(
    ({ key, name, category, unit, description, required_keys, formula }) => ({
      key,
      name,
      category,
      unit,
      description,
      required_keys,
      formula
    })
  );
}

/** Every financial key that any calculation needs. */
export function getAllRequiredKeys() {
  const keys = new Set();
  for (const calc of Object.values(CALCULATIONS)) {
    calc.required_keys.forEach((k) => keys.add(k));
  }
  return [...keys];
}

/** Required keys that are missing or unusable in the given data. */
export function getMissingKeys(calculationKey, financialData) {
  const calc = CALCULATIONS[calculationKey];
  return calc.required_keys.filter((k) => toUsableNumber(financialData[k]) === null);
}

// ---------------------------------------------------------------
// Execution
// ---------------------------------------------------------------

/**
 * Runs ONE known calculation.
 * Returns { ok: true, result } or { ok: false, unavailable }.
 */
export function runCalculation(calculationKey, financialData) {
  if (!isKnownCalculation(calculationKey)) {
    throw new Error(`Unknown calculation function: ${calculationKey}`);
  }

  const calc = CALCULATIONS[calculationKey];
  const missingKeys = getMissingKeys(calculationKey, financialData);

  if (missingKeys.length > 0) {
    return {
      ok: false,
      unavailable: {
        calculation: calc.key,
        name: calc.name,
        reason: "Required financial values are missing",
        missing_keys: missingKeys
      }
    };
  }

  // Build a clean numeric input object containing ONLY the required keys.
  const inputs = {};
  for (const k of calc.required_keys) {
    inputs[k] = toUsableNumber(financialData[k]);
  }

  const raw = calc.calculate(inputs);

  // Division by zero or similar produces Infinity / NaN — never report it.
  if (!Number.isFinite(raw)) {
    return {
      ok: false,
      unavailable: {
        calculation: calc.key,
        name: calc.name,
        reason: "Calculation is undefined for these values (division by zero)",
        missing_keys: []
      }
    };
  }

  return {
    ok: true,
    result: {
      name: calc.name,
      category: calc.category,
      formula: calc.formula,
      inputs,
      value: roundForUnit(raw, calc.unit),
      unit: calc.unit
    }
  };
}

/**
 * Runs a list of calculation keys (e.g. selected by the Analysis Agent).
 * Unknown keys are rejected, never executed.
 */
export function executeCalculations(calculationKeys, financialData) {
  const calculated_ratios = {};
  const unavailable_calculations = [];
  const rejected_calculations = [];

  for (const key of new Set(calculationKeys)) {
    if (!isKnownCalculation(key)) {
      rejected_calculations.push({
        calculation: String(key),
        reason: "Unknown calculation function"
      });
      continue;
    }

    const outcome = runCalculation(key, financialData);
    if (outcome.ok) {
      calculated_ratios[key] = outcome.result;
    } else {
      unavailable_calculations.push(outcome.unavailable);
    }
  }

  return { calculated_ratios, unavailable_calculations, rejected_calculations };
}

/** Every known calculation that cannot run on this data, with its missing keys. */
export function findUnavailableCalculations(financialData) {
  return Object.keys(CALCULATIONS)
    .map((key) => runCalculation(key, financialData))
    .filter((outcome) => !outcome.ok)
    .map((outcome) => outcome.unavailable);
}
