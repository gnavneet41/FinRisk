// ============================================================
// RULE-BASED FALLBACKS
// ------------------------------------------------------------
// Used only when the LLM is unavailable (busy, no key, invalid
// output) and LLM_FALLBACK is not "false".
//
// They follow the same architecture rules as the LLM agents:
//   - no invented values, only extracted data and engine ratios
//   - no industry benchmarks: levels use only definitional
//     break-even points (ratio = 1, value = 0), documented below
// The output says generated_by.method = "rule_based" so the
// frontend and the report show which method was used.
// ============================================================

import {
  ANALYSIS_CATEGORIES,
  getCalculationCatalog,
  getMissingKeys
} from "./calculationEngine.service.js";

const LEVEL_ORDER = ["low", "moderate", "elevated", "high"];
const maxLevel = (levels) =>
  levels.reduce((max, l) => (LEVEL_ORDER.indexOf(l) > LEVEL_ORDER.indexOf(max) ? l : max), "low");

const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : String(n));


// ============================================================
// ANALYSIS AGENT FALLBACK
// ============================================================

export function buildRuleBasedPlan(availableData) {
  const catalog = getCalculationCatalog();

  // Every calculation whose required values are all present.
  const selected_calculations = catalog
    .filter((c) => getMissingKeys(c.key, availableData).length === 0)
    .map((c) => c.key);

  const categories = new Set(
    catalog.filter((c) => selected_calculations.includes(c.key)).map((c) => c.category)
  );
  if (has(availableData, "total_assets", "total_liabilities")) categories.add("balance_sheet_analysis");
  if (has(availableData, "revenue", "net_income")) categories.add("income_statement_analysis");
  if (has(availableData, "operating_cash_flow")) categories.add("cash_flow_statement_analysis");

  return {
    analysis_categories: ANALYSIS_CATEGORIES.filter((c) => categories.has(c)),
    selected_calculations,
    observations: signObservations(availableData),
    unavailable_calculations: [],
    rejected_calculations: []
  };
}

function has(data, ...keys) {
  return keys.every((k) => typeof data[k] === "number");
}

/** Facts about the sign of key values — no arithmetic. */
function signObservations(d) {
  const obs = [];
  const add = (key, positive, negative) => {
    if (typeof d[key] !== "number") return;
    if (d[key] > 0 && positive) obs.push({ key, value: String(d[key]), reason: positive });
    if (d[key] < 0 && negative) obs.push({ key, value: String(d[key]), reason: negative });
  };

  add("net_income", "The company reported positive net income.", "The company reported a net loss.");
  add("operating_cash_flow", "Operating activities generated positive cash flow.",
      "Operating activities used cash (negative operating cash flow).");
  add("investing_cash_flow", "Investing activities produced a net cash inflow.",
      "Investing activities produced a net cash outflow.");
  add("financing_cash_flow", "Financing activities produced a net cash inflow.",
      "Financing activities produced a net cash outflow.");
  add("net_cash_change", "Cash increased over the period.", "Cash decreased over the period.");
  add("total_equity", null, "Shareholders' equity is negative.");
  return obs;
}


// ============================================================
// RISK ADVISOR FALLBACK
// ------------------------------------------------------------
// Method (documented for the project report):
//   Liquidity  : current ratio < 1        -> elevated
//                ...but operating cash flow > 0 -> moderate (mitigated)
//                current ratio >= 1       -> low
//   Solvency   : total equity <= 0        -> high
//                debt-to-equity > 1       -> moderate
//                otherwise                -> low
//   Profitability: net margin < 0         -> high
//                operating margin < 0     -> elevated
//                otherwise                -> low
//   Cash flow  : operating cash flow < 0  -> high
//                otherwise                -> low
//   Efficiency : not rated (needs industry benchmarks)
//   Overall    : the highest category level
// ============================================================

export function buildRuleBasedRiskAssessment(input, knowledge) {
  const r = input.calculated_ratios;
  const d = input.financial_data;
  const knowledgeIds = new Set(knowledge.map((k) => k.id));
  const refs = (...ids) => ids.filter((id) => knowledgeIds.has(id));
  const ratioEv = (key) => r[key]
    ? [{ type: "ratio", key, name: r[key].name, value: r[key].value, unit: r[key].unit }] : [];
  const dataEv = (key) => typeof d[key] === "number" ? [{ type: "data", key, value: d[key] }] : [];

  const factors = [];
  const categories = [];
  const recommendations = [];
  const benchmarks_unavailable = [];
  let n = 0;
  const nextId = () => `RF${++n}`;

  // ---------- Liquidity ----------
  if (r.current_ratio) {
    const cr = r.current_ratio.value;
    const ocfPositive = typeof d.operating_cash_flow === "number" && d.operating_cash_flow > 0;
    let level = "low";
    let text = `The current ratio is ${cr}, so current assets cover current liabilities.`;

    if (cr < 1) {
      level = ocfPositive ? "moderate" : "elevated";
      text = `The current ratio is ${cr}, meaning current liabilities exceed current assets.` +
        (r.quick_ratio ? ` The quick ratio is ${r.quick_ratio.value}.` : "") +
        (ocfPositive
          ? ` This is partly mitigated by positive operating cash flow of ${fmt(d.operating_cash_flow)}` +
            (r.cfo_to_current_liabilities
              ? ` (CFO / current liabilities ${r.cfo_to_current_liabilities.value}).` : ".")
          : " Operating cash flow does not offset this.");
    }

    const id = nextId();
    factors.push({
      id, category: "liquidity_risk", title: cr < 1
        ? "Current liabilities exceed current assets" : "Current assets cover current liabilities",
      level,
      evidence: [...ratioEv("current_ratio"), ...ratioEv("quick_ratio"),
        ...ratioEv("cfo_to_current_liabilities"), ...dataEv("operating_cash_flow")],
      knowledge_refs: refs("K-LIQ-01", "K-LIQ-02", "K-LIQ-03"),
      interpretation: text
    });
    categories.push({ category: "liquidity_risk", level, summary: text });
    if (cr < 1) {
      recommendations.push({
        text: "Monitor short-term obligations against operating cash flow, and compare the liquidity ratios with industry peers and prior years.",
        related_risk_factors: [id]
      });
      benchmarks_unavailable.push("Industry current and quick ratios");
    }
  }

  // ---------- Solvency ----------
  if (r.debt_to_equity || typeof d.total_equity === "number") {
    let level = "low";
    let text;
    if (typeof d.total_equity === "number" && d.total_equity <= 0) {
      level = "high";
      text = `Shareholders' equity is ${fmt(d.total_equity)} (zero or negative), so liabilities exceed assets.`;
    } else if (r.debt_to_equity && r.debt_to_equity.value > 1) {
      level = "moderate";
      text = `Debt-to-equity is ${r.debt_to_equity.value}, meaning debt exceeds shareholders' equity.` +
        (r.debt_ratio ? ` The debt ratio (debt / total assets) is ${r.debt_ratio.value}.` : "") +
        " A low equity balance (for example after share buybacks) can raise this ratio without new borrowing.";
    } else {
      text = r.debt_to_equity
        ? `Debt-to-equity is ${r.debt_to_equity.value}, meaning debt does not exceed equity.`
        : "Equity is positive.";
    }

    const id = nextId();
    factors.push({
      id, category: "solvency_risk",
      title: level === "low" ? "Leverage within equity base" : "Reliance on debt financing",
      level,
      evidence: [...ratioEv("debt_to_equity"), ...ratioEv("debt_ratio"),
        ...ratioEv("liabilities_to_assets"), ...dataEv("total_equity")],
      knowledge_refs: refs("K-SOL-01", "K-SOL-02"),
      interpretation: text
    });
    categories.push({ category: "solvency_risk", level, summary: text });
    if (level !== "low") {
      recommendations.push({
        text: "Review the debt maturity schedule and the reasons for the low equity balance before drawing conclusions on leverage.",
        related_risk_factors: [id]
      });
    }
  }

  // ---------- Profitability ----------
  if (r.net_profit_margin || r.operating_margin) {
    const nm = r.net_profit_margin?.value;
    const om = r.operating_margin?.value;
    let level = "low";
    if (typeof nm === "number" && nm < 0) level = "high";
    else if (typeof om === "number" && om < 0) level = "elevated";

    const parts = [];
    if (r.gross_margin) parts.push(`gross margin ${r.gross_margin.value}%`);
    if (r.operating_margin) parts.push(`operating margin ${om}%`);
    if (r.net_profit_margin) parts.push(`net profit margin ${nm}%`);
    const text = level === "low"
      ? `The company is profitable at every level reported (${parts.join(", ")}).`
      : `Profitability is negative (${parts.join(", ")}).`;

    const roeNote = r.return_on_equity && r.return_on_assets
      ? ` Return on equity (${r.return_on_equity.value}%) should be read alongside return on assets (${r.return_on_assets.value}%), because a small equity base inflates ROE.`
      : "";

    const id = nextId();
    factors.push({
      id, category: "profitability_risk",
      title: level === "low" ? "Positive margins" : "Losses reported",
      level,
      evidence: [...ratioEv("gross_margin"), ...ratioEv("operating_margin"),
        ...ratioEv("net_profit_margin"), ...ratioEv("return_on_equity"), ...ratioEv("return_on_assets")],
      knowledge_refs: refs("K-PRO-01", "K-PRO-02", "K-PRO-03"),
      interpretation: text + roeNote
    });
    categories.push({ category: "profitability_risk", level, summary: text });
    benchmarks_unavailable.push("Industry profit margins");
  }

  // ---------- Cash flow ----------
  if (typeof d.operating_cash_flow === "number") {
    const level = d.operating_cash_flow < 0 ? "high" : "low";
    let text = level === "high"
      ? `Operating cash flow is negative (${fmt(d.operating_cash_flow)}).`
      : `Operating cash flow is positive (${fmt(d.operating_cash_flow)}).`;
    if (typeof d.financing_cash_flow === "number" && d.financing_cash_flow < 0) {
      text += ` Financing cash flow of ${fmt(d.financing_cash_flow)} reflects net payments to capital providers` +
        " (e.g. debt repayment, dividends or buybacks).";
    }

    const id = nextId();
    factors.push({
      id, category: "cash_flow_risk",
      title: level === "high" ? "Negative operating cash flow" : "Positive operating cash flow",
      level,
      evidence: [...dataEv("operating_cash_flow"), ...dataEv("net_income"),
        ...dataEv("financing_cash_flow"), ...dataEv("net_cash_change")],
      knowledge_refs: refs("K-CF-01", "K-CF-02", "K-CF-03"),
      interpretation: text
    });
    categories.push({ category: "cash_flow_risk", level, summary: text });
    if (level === "high") {
      recommendations.push({
        text: "Investigate why operations are using cash and how the shortfall is being funded.",
        related_risk_factors: [id]
      });
    }
  }

  // ---------- Efficiency: not rated ----------
  if (r.asset_turnover || r.inventory_turnover || r.receivables_turnover) {
    benchmarks_unavailable.push("Industry asset, inventory and receivables turnover");
  }

  const overallLevel = maxLevel(categories.map((c) => c.level));
  const drivers = factors.filter((f) => f.level === overallLevel && f.level !== "low").map((f) => f.id);

  recommendations.push({
    text: "Add prior-year figures and industry benchmarks to turn this single-year snapshot into a trend and peer comparison.",
    related_risk_factors: []
  });

  return {
    risk_factors: factors,
    category_assessments: categories,
    overall_assessment: {
      level: overallLevel,
      summary:
        `Rule-based assessment (LLM unavailable). The overall level is the highest category level: ${overallLevel}. ` +
        categories.map((c) => `${c.category.replaceAll("_", " ")}: ${c.level}`).join("; ") + ".",
      key_drivers: drivers
    },
    recommendations,
    limitations: [
      "Generated by the rule-based fallback because the LLM was unavailable; interpretation is less detailed.",
      "Efficiency ratios are reported but not rated, because rating them requires industry benchmarks."
    ],
    benchmarks_unavailable: [...new Set(benchmarks_unavailable)],
    validation_notes: []
  };
}
