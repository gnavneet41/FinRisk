// Labels and number formatting shared by the components.

export const FIELD_GROUPS = [
  {
    title: "Company",
    fields: [
      ["company", "Company name"],
      ["fiscal_year", "Fiscal year"]
    ]
  },
  {
    title: "Income statement",
    fields: [
      ["revenue", "Revenue"],
      ["cost_of_goods_sold", "Cost of sales"],
      ["gross_profit", "Gross profit"],
      ["operating_expenses", "Operating expenses"],
      ["operating_income", "Operating income"],
      ["income_before_tax", "Income before tax"],
      ["income_tax", "Income tax"],
      ["net_income", "Net income"],
      ["diluted_eps", "Diluted EPS"]
    ]
  },
  {
    title: "Balance sheet",
    fields: [
      ["cash", "Cash and equivalents"],
      ["short_term_investments", "Short-term investments"],
      ["accounts_receivable", "Accounts receivable"],
      ["inventory", "Inventory"],
      ["current_assets", "Total current assets"],
      ["total_assets", "Total assets"],
      ["accounts_payable", "Accounts payable"],
      ["short_term_debt", "Short-term debt"],
      ["current_liabilities", "Total current liabilities"],
      ["long_term_debt", "Long-term debt"],
      ["total_liabilities", "Total liabilities"],
      ["total_equity", "Shareholders' equity"],
      ["total_debt", "Total debt"]
    ]
  },
  {
    title: "Cash flow statement",
    fields: [
      ["operating_cash_flow", "Operating cash flow"],
      ["investing_cash_flow", "Investing cash flow"],
      ["financing_cash_flow", "Financing cash flow"],
      ["net_cash_change", "Net change in cash"],
      ["beginning_cash", "Beginning cash"],
      ["ending_cash", "Ending cash"]
    ]
  }
];

export const FIELD_LABELS = Object.fromEntries(FIELD_GROUPS.flatMap((g) => g.fields));

export const RISK_LEVELS = ["low", "moderate", "elevated", "high"];

export const CATEGORY_NAMES = {
  liquidity_risk: "Liquidity",
  solvency_risk: "Solvency",
  profitability_risk: "Profitability",
  efficiency_risk: "Efficiency",
  cash_flow_risk: "Cash flow",
  liquidity_analysis: "Liquidity",
  solvency_analysis: "Solvency",
  profitability_analysis: "Profitability",
  efficiency_analysis: "Efficiency",
  cash_flow_analysis: "Cash flow",
  balance_sheet_analysis: "Balance sheet",
  income_statement_analysis: "Income statement",
  cash_flow_statement_analysis: "Cash flow statement"
};

export const labelFor = (key) =>
  FIELD_LABELS[key] ?? CATEGORY_NAMES[key] ??
  String(key).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function formatRatio(value, unit) {
  if (typeof value !== "number") return "—";
  if (unit === "percent") return `${value.toFixed(2)}%`;
  if (unit === "times") return `${value.toFixed(2)}×`;
  return value.toFixed(4);
}

export function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function methodLabel(generatedBy) {
  if (!generatedBy) return "—";
  return generatedBy.method === "llm"
    ? `${capitalize(generatedBy.provider)} (${generatedBy.model})`
    : "Rule-based fallback";
}
