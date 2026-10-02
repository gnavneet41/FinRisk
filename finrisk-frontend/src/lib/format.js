// Labels, descriptions and number formatting shared across pages.

export const FIELD_GROUPS = [
  { title: "Company", fields: [["company", "Company name"], ["fiscal_year", "Fiscal year"]] },
  {
    title: "Income statement",
    fields: [
      ["revenue", "Revenue"], ["cost_of_goods_sold", "Cost of sales"], ["gross_profit", "Gross profit"],
      ["operating_expenses", "Operating expenses"], ["operating_income", "Operating income"],
      ["income_before_tax", "Income before tax"], ["income_tax", "Income tax"], ["net_income", "Net income"],
      ["diluted_eps", "Diluted EPS"]
    ]
  },
  {
    title: "Balance sheet",
    fields: [
      ["cash", "Cash and equivalents"], ["short_term_investments", "Short-term investments"],
      ["accounts_receivable", "Accounts receivable"], ["inventory", "Inventory"],
      ["current_assets", "Total current assets"], ["total_assets", "Total assets"],
      ["accounts_payable", "Accounts payable"], ["short_term_debt", "Short-term debt"],
      ["current_liabilities", "Total current liabilities"], ["long_term_debt", "Long-term debt"],
      ["total_liabilities", "Total liabilities"], ["total_equity", "Shareholders' equity"], ["total_debt", "Total debt"]
    ]
  },
  {
    title: "Cash flow statement",
    fields: [
      ["operating_cash_flow", "Operating cash flow"], ["investing_cash_flow", "Investing cash flow"],
      ["financing_cash_flow", "Financing cash flow"], ["net_cash_change", "Net change in cash"],
      ["beginning_cash", "Beginning cash"], ["ending_cash", "Ending cash"]
    ]
  }
];

export const FIELD_LABELS = Object.fromEntries(FIELD_GROUPS.flatMap((g) => g.fields));

export const CATEGORIES = [
  { key: "liquidity", analysis: "liquidity_analysis", risk: "liquidity_risk", name: "Liquidity",
    question: "Can the company pay its short-term obligations?" },
  { key: "solvency", analysis: "solvency_analysis", risk: "solvency_risk", name: "Solvency",
    question: "How much does the company rely on debt?" },
  { key: "profitability", analysis: "profitability_analysis", risk: "profitability_risk", name: "Profitability",
    question: "How much profit does each unit of revenue produce?" },
  { key: "efficiency", analysis: "efficiency_analysis", risk: "efficiency_risk", name: "Efficiency",
    question: "How well are assets, inventory and receivables used?" },
  { key: "cash_flow", analysis: "cash_flow_analysis", risk: "cash_flow_risk", name: "Cash Flow",
    question: "Is the business generating cash?" }
];

export const CATEGORY_BY_ANALYSIS = Object.fromEntries(CATEGORIES.map((c) => [c.analysis, c]));
export const CATEGORY_BY_RISK = Object.fromEntries(CATEGORIES.map((c) => [c.risk, c]));

// Plain-language description of each ratio (shown on ratio cards).
export const RATIO_INFO = {
  current_ratio: "Current assets available for each unit of current liabilities. Below 1 means short-term obligations exceed short-term assets.",
  quick_ratio: "Like the current ratio, but counts only cash, short-term investments and receivables.",
  cash_ratio: "The strictest liquidity test: only cash and short-term investments against current liabilities.",
  debt_to_equity: "Borrowed money for each unit of shareholders' equity. Above 1 means debt exceeds equity.",
  debt_ratio: "Share of total assets financed by interest-bearing debt.",
  liabilities_to_assets: "Share of total assets financed by all liabilities, including payables and deferred revenue.",
  gross_margin: "Revenue left after the direct cost of products and services sold.",
  operating_margin: "Revenue left after cost of sales and operating expenses.",
  net_profit_margin: "Revenue left as profit after all expenses and taxes.",
  return_on_assets: "Net income earned on the company's asset base.",
  return_on_equity: "Net income relative to shareholders' equity. A small equity base makes it very large.",
  asset_turnover: "Revenue generated for each unit of assets.",
  inventory_turnover: "How many times inventory is sold and replaced during the year.",
  receivables_turnover: "How many times receivables are collected during the year.",
  cfo_to_current_liabilities: "Share of current liabilities one year of operating cash flow could cover.",
  interest_coverage: "How many times operating income covers interest expense."
};

export const RISK_LEVELS = ["low", "moderate", "elevated", "high"];

export const RISK_STYLE = {
  low: { label: "Low", badge: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", dot: "bg-emerald-500", text: "text-emerald-700", bar: "bg-emerald-500" },
  moderate: { label: "Moderate", badge: "bg-amber-50 text-amber-800 ring-amber-600/25", dot: "bg-amber-500", text: "text-amber-700", bar: "bg-amber-500" },
  elevated: { label: "Elevated", badge: "bg-orange-50 text-orange-800 ring-orange-600/25", dot: "bg-orange-500", text: "text-orange-700", bar: "bg-orange-500" },
  high: { label: "High", badge: "bg-red-50 text-red-700 ring-red-600/20", dot: "bg-red-500", text: "text-red-700", bar: "bg-red-500" }
};

export const STATUS_STYLE = {
  uploaded: { label: "Uploaded", cls: "bg-slate-100 text-slate-700" },
  extracted: { label: "Extracted", cls: "bg-slate-100 text-slate-700" },
  validated: { label: "Validated", cls: "bg-sky-50 text-sky-700" },
  needs_review: { label: "Needs review", cls: "bg-amber-50 text-amber-800" },
  analyzing: { label: "Analyzing", cls: "bg-brand-50 text-brand-700" },
  completed: { label: "Completed", cls: "bg-emerald-50 text-emerald-700" },
  failed: { label: "Failed", cls: "bg-red-50 text-red-700" }
};

export const labelFor = (key) =>
  FIELD_LABELS[key] ?? String(key).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** USD millions -> "$391,035M" */
export function money(value) {
  if (typeof value !== "number") return "—";
  const sign = value < 0 ? "−" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US")}M`;
}

export function number(value, digits = 4) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function ratioValue(value, unit) {
  if (typeof value !== "number") return "—";
  if (unit === "percent") return `${value.toFixed(2)}%`;
  if (unit === "times") return `${value.toFixed(2)}×`;
  return value.toFixed(4);
}

export function dataValue(key, value) {
  if (typeof value !== "number") return value ?? "—";
  return key === "diluted_eps" ? `$${value.toFixed(2)}` : money(value);
}

export const date = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
export const dateTime = (d) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export function fileSize(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function methodLabel(g) {
  if (!g) return "—";
  return g.method === "llm" ? `${g.provider === "gemini" ? "Gemini" : g.provider} (${g.model})` : "Rule-based fallback";
}

export const titleCase = (s) => String(s ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
