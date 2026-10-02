// ============================================================
// RISK ADVISOR AGENT
// ------------------------------------------------------------
// Input : Analysis Agent output (facts + deterministic ratios)
//         + knowledge retrieved from the knowledge base (RAG)
// Output: risk factors, category assessments, overall assessment,
//         recommendations, limitations.
//
// This is the ONLY stage that assigns risk levels.
// One Gemini call. Gemini output is untrusted and is checked:
//   - every risk factor must cite real ratios / data keys
//   - cited values are replaced with the real numbers
//   - knowledge references must be entries that were retrieved
//   - levels and categories must come from fixed lists
//   - numbers in the text that do not match any known value
//     are reported in validation_notes
// ============================================================

import { generateJson, isFallbackEnabled } from "./llm.service.js";
import { buildRuleBasedRiskAssessment } from "./fallback.service.js";
import { retrieveKnowledge } from "./knowledgeBase.service.js";

export const RISK_CATEGORIES = [
  "liquidity_risk",
  "solvency_risk",
  "profitability_risk",
  "efficiency_risk",
  "cash_flow_risk"
];

export const RISK_LEVELS = ["low", "moderate", "elevated", "high"];


// ============================================================
// 1. INPUT — only what the Risk Advisor needs (small prompt)
// ============================================================

export function buildRiskAdvisorInput(analysis) {
  const ratios = {};
  for (const [key, r] of Object.entries(analysis.calculated_ratios ?? {})) {
    ratios[key] = {
      name: r.name,
      category: r.category,
      formula: r.formula,
      value: r.value,
      unit: r.unit
    };
  }

  return {
    company: analysis.company,
    fiscal_year: analysis.fiscal_year,
    financial_data: analysis.available_data ?? {},
    observations: analysis.observations ?? [],
    analysis_categories: analysis.analysis_categories ?? [],
    calculated_ratios: ratios,
    unavailable_calculations: (analysis.unavailable_calculations ?? []).map((u) => ({
      calculation: u.calculation,
      missing_keys: u.missing_keys
    }))
  };
}


// ============================================================
// 2. PROMPT
// ============================================================

export function buildRiskPrompt(input, knowledge) {
  return `
You are the Risk Advisor Agent in a financial risk assessment system.

You receive:
- facts extracted from a financial document,
- ratios already calculated by a deterministic Calculation Engine,
- knowledge entries retrieved from the system's knowledge base.

RULES:
1. Base every risk factor ONLY on the provided ratios, financial data and knowledge entries.
2. Do NOT perform new calculations. Do not derive new numbers. Quote only values given below.
3. Do NOT invent industry benchmarks, peer averages or thresholds. Where a benchmark would be
   needed and is not in the knowledge, say it is unavailable and list it in "benchmarks_unavailable".
   Bank regulatory ratios (Basel) apply to banks only; never apply them to non-financial companies.
4. Do not use or estimate unavailable values (see UNAVAILABLE CALCULATIONS).
5. Consider mitigating evidence as well as concerns (e.g. strong operating cash flow next to a low current ratio).
6. Every risk factor must cite evidence by key:
   - type "ratio": a key from CALCULATED RATIOS
   - type "data": a key from FINANCIAL DATA
7. Cite knowledge entries by their id in "knowledge_refs".
8. Use only these risk categories: ${JSON.stringify(RISK_CATEGORIES)}
9. Use only these levels: ${JSON.stringify(RISK_LEVELS)}
10. Keep it compact: at most 6 risk factors, one category assessment per category,
    at most 5 recommendations, and 2-4 sentences per interpretation.

COMPANY: ${input.company ?? "Unavailable"}
FISCAL YEAR: ${input.fiscal_year ?? "Unavailable"}

FINANCIAL DATA (USD millions unless stated):
${JSON.stringify(input.financial_data)}

CALCULATED RATIOS (percent units are already multiplied by 100):
${JSON.stringify(input.calculated_ratios, null, 1)}

ANALYSIS AGENT OBSERVATIONS:
${JSON.stringify(input.observations, null, 1)}

UNAVAILABLE CALCULATIONS:
${JSON.stringify(input.unavailable_calculations)}

RETRIEVED KNOWLEDGE (global knowledge base + this company's private knowledge):
${JSON.stringify(knowledge.map(({ id, title, scope, content }) => ({ id, title, scope, content })), null, 1)}

Return ONLY valid JSON in exactly this format:
{
  "risk_factors": [
    {
      "id": "RF1",
      "category": "liquidity_risk",
      "title": "short title",
      "level": "moderate",
      "evidence": [ { "type": "ratio", "key": "current_ratio" }, { "type": "data", "key": "operating_cash_flow" } ],
      "knowledge_refs": ["K-LIQ-01"],
      "interpretation": "2-4 sentences explaining the risk and any mitigating evidence"
    }
  ],
  "category_assessments": [
    { "category": "liquidity_risk", "level": "moderate", "summary": "1-2 sentences" }
  ],
  "overall_assessment": {
    "level": "moderate",
    "summary": "3-5 sentences",
    "key_drivers": ["RF1"]
  },
  "recommendations": [
    { "text": "specific, actionable recommendation", "related_risk_factors": ["RF1"] }
  ],
  "limitations": ["e.g. single fiscal year only"],
  "benchmarks_unavailable": ["e.g. industry current ratio"]
}
`.trim();
}


// ============================================================
// 3. VALIDATION OF GEMINI OUTPUT
// ============================================================

const asArray = (v) => (Array.isArray(v) ? v : []);
const cleanText = (v) => (typeof v === "string" ? v.trim() : "");

export function validateRiskAssessment(raw, input, knowledge) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid risk assessment returned by Risk Advisor");
  }

  const ratios = input.calculated_ratios;
  const data = input.financial_data;
  const knowledgeIds = new Set(knowledge.map((k) => k.id));
  const categories = new Set(RISK_CATEGORIES);
  const levels = new Set(RISK_LEVELS);
  const notes = [];

  // ---------- risk factors ----------
  const risk_factors = [];
  const usedIds = new Set();

  asArray(raw.risk_factors).forEach((rf, index) => {
    if (!rf || typeof rf !== "object") return;

    const id = cleanText(rf.id) || `RF${index + 1}`;
    if (usedIds.has(id)) return;

    if (!categories.has(rf.category) || !levels.has(rf.level)) {
      notes.push(`Dropped risk factor ${id}: invalid category or level`);
      return;
    }

    // Evidence: keep only real keys, and attach the REAL values.
    const evidence = [];
    for (const ev of asArray(rf.evidence)) {
      if (ev?.type === "ratio" && Object.hasOwn(ratios, ev.key)) {
        evidence.push({
          type: "ratio",
          key: ev.key,
          name: ratios[ev.key].name,
          value: ratios[ev.key].value,
          unit: ratios[ev.key].unit
        });
      } else if (ev?.type === "data" && Object.hasOwn(data, ev.key)) {
        evidence.push({ type: "data", key: ev.key, value: data[ev.key] });
      }
    }

    // A risk claim without verifiable evidence is not accepted.
    if (evidence.length === 0) {
      notes.push(`Dropped risk factor ${id}: no valid evidence`);
      return;
    }

    usedIds.add(id);
    risk_factors.push({
      id,
      category: rf.category,
      title: cleanText(rf.title) || id,
      level: rf.level,
      evidence,
      knowledge_refs: asArray(rf.knowledge_refs).filter((k) => knowledgeIds.has(k)),
      interpretation: cleanText(rf.interpretation)
    });
  });

  // ---------- category assessments ----------
  const seenCategories = new Set();
  const category_assessments = asArray(raw.category_assessments)
    .filter((c) => c && categories.has(c.category) && levels.has(c.level))
    .filter((c) => !seenCategories.has(c.category) && seenCategories.add(c.category))
    .map((c) => ({ category: c.category, level: c.level, summary: cleanText(c.summary) }));

  // ---------- overall assessment (required) ----------
  const overall = raw.overall_assessment;
  if (!overall || !levels.has(overall.level)) {
    throw new Error("Invalid risk assessment returned by Risk Advisor (missing overall level)");
  }
  const overall_assessment = {
    level: overall.level,
    summary: cleanText(overall.summary),
    key_drivers: asArray(overall.key_drivers).filter((id) => usedIds.has(id))
  };

  // ---------- recommendations ----------
  const recommendations = asArray(raw.recommendations)
    .map((r) => (typeof r === "string" ? { text: r } : r))
    .filter((r) => r && cleanText(r.text))
    .map((r) => ({
      text: cleanText(r.text),
      related_risk_factors: asArray(r.related_risk_factors).filter((id) => usedIds.has(id))
    }));

  // ---------- limitations (Gemini's + deterministic ones) ----------
  const limitations = asArray(raw.limitations).map(cleanText).filter(Boolean);
  for (const u of input.unavailable_calculations) {
    limitations.push(
      `${u.calculation} could not be calculated (missing: ${u.missing_keys.join(", ")}).`
    );
  }

  const benchmarks_unavailable = asArray(raw.benchmarks_unavailable).map(cleanText).filter(Boolean);

  // ---------- number check ----------
  // Flags numbers in Gemini's text that do not match any known value,
  // which would mean Gemini calculated or invented a number.
  const texts = [
    ...risk_factors.map((r) => r.interpretation),
    ...category_assessments.map((c) => c.summary),
    overall_assessment.summary,
    ...recommendations.map((r) => r.text)
  ];
  const unverified = findUnverifiedNumbers(texts, input, knowledge);
  if (unverified.length > 0) {
    notes.push(
      `Numbers in the narrative that do not match any extracted or calculated value: ${unverified.join(", ")}`
    );
  }

  return {
    risk_factors,
    category_assessments,
    overall_assessment,
    recommendations,
    limitations: [...new Set(limitations)],
    benchmarks_unavailable,
    validation_notes: notes
  };
}


// ============================================================
// NUMBER CHECK HELPERS
// ============================================================

function collectKnownNumbers(input, knowledge) {
  const known = [];
  for (const v of Object.values(input.financial_data)) {
    if (typeof v === "number") known.push(v, v / 1000); // millions or billions
  }
  for (const r of Object.values(input.calculated_ratios)) {
    known.push(r.value);
    if (r.unit !== "percent") known.push(r.value * 100); // 0.2922 -> 29.22%
  }
  // Numbers from the fiscal year and knowledge texts (e.g. "1.0", "2024").
  const extraText = [input.fiscal_year ?? "", ...knowledge.map((k) => k.content)].join(" ");
  for (const m of extraText.matchAll(/\d+(?:\.\d+)?/g)) known.push(Number(m[0]));
  return known;
}

function findUnverifiedNumbers(texts, input, knowledge) {
  const known = collectKnownNumbers(input, knowledge);
  const unverified = new Set();

  for (const text of texts) {
    for (const match of String(text).matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
      const written = match[0];
      const value = Math.abs(Number(written.replace(/,/g, "")));
      if (!Number.isFinite(value) || value < 10 && Number.isInteger(value)) continue; // skip small counts like "3"

      const decimals = (written.split(".")[1] ?? "").length;
      const ok = known.some((k) => {
        const rounded = Number(Math.abs(k).toFixed(decimals));
        return Math.abs(rounded - value) < 1e-9 ||
               Math.abs(Math.round(Math.abs(k)) - value) < 1e-9;
      });
      if (!ok) unverified.add(written);
    }
  }
  return [...unverified];
}


// ============================================================
// 4. RUN  (retrieval + one LLM call + validation, rule-based fallback)
// ============================================================

export async function runRiskAdvisor(analysis, { companyId = null } = {}) {
  const input = buildRiskAdvisorInput(analysis);
  // Global knowledge + this company's private knowledge only.
  const knowledge = await retrieveKnowledge(analysis, { companyId });

  const prompt = buildRiskPrompt(input, knowledge);
  console.log(
    `[Risk Advisor] ${knowledge.length} knowledge entries retrieved; ` +
    `sending prompt to LLM (${prompt.length} chars)`
  );

  let assessment;
  let generated_by;
  try {
    const { data, model, provider } = await generateJson(prompt, { label: "Risk Advisor" });
    assessment = validateRiskAssessment(data, input, knowledge);
    generated_by = { method: "llm", provider, model };
  } catch (error) {
    if (!isFallbackEnabled()) throw error;

    console.warn(`[Risk Advisor] LLM unavailable, using rule-based assessment: ${error.message}`);
    assessment = buildRuleBasedRiskAssessment(input, knowledge);
    for (const u of input.unavailable_calculations) {
      assessment.limitations.push(
        `${u.calculation} could not be calculated (missing: ${u.missing_keys.join(", ")}).`
      );
    }
    generated_by = { method: "rule_based", llm_error: error.message };
  }

  return {
    company: input.company,
    fiscal_year: input.fiscal_year,
    ...assessment,
    generated_by,
    retrieved_knowledge: knowledge.map(({ id, title, document_title, scope, source, matched_terms, kind }) => ({
      id,
      title,
      document_title,
      scope,
      kind,
      source,
      matched_terms
    }))
  };
}
