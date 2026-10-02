// ============================================================
// RISK ADVISOR CHATBOT
// ------------------------------------------------------------
// Answers user questions about a report.
//   1. Retrieve context: the report's own results + RAG knowledge
//   2. One LLM call that must answer only from that context
//   3. Validate cited sources
// Fallback (no LLM): a retrieval-only answer built from the
// matching ratios and knowledge chunks.
// ============================================================

import { generateJson, isFallbackEnabled } from "./llm.service.js";
import { searchKnowledge, tokenize } from "./knowledgeBase.service.js";

const MAX_QUESTION_CHARS = 1000;
const MAX_HISTORY_TURNS = 6;


// ============================================================
// CONTEXT FROM THE REPORT
// ============================================================

/** Compact, citable facts from a stored report. Each has an id. */
export function buildReportContext(report) {
  if (!report?.analysis) return [];
  const facts = [];
  const a = report.analysis;
  const r = report.risk_assessment;

  facts.push({
    id: "report:company",
    text: `Company: ${a.company ?? "unknown"}, fiscal year: ${a.fiscal_year ?? "unknown"}.`
  });

  for (const [key, ratio] of Object.entries(a.calculated_ratios ?? {})) {
    facts.push({
      id: `ratio:${key}`,
      text: `${ratio.name} = ${ratio.value}${ratio.unit === "percent" ? "%" : ""} (formula: ${ratio.formula}).`
    });
  }
  for (const u of a.unavailable_calculations ?? []) {
    facts.push({
      id: `unavailable:${u.calculation}`,
      text: `${u.name ?? u.calculation} was not calculated because these values are missing: ${(u.missing_keys ?? []).join(", ")}.`
    });
  }
  for (const [key, value] of Object.entries(a.available_data ?? {})) {
    if (typeof value === "number") facts.push({ id: `data:${key}`, text: `${key} = ${value} (USD millions unless per-share).` });
  }
  for (const o of a.observations ?? []) {
    facts.push({ id: `observation:${o.key}`, text: `Observation on ${o.key} (${o.value}): ${o.reason}` });
  }
  if (r) {
    facts.push({
      id: "risk:overall",
      text: `Overall risk level: ${r.overall_assessment.level}. ${r.overall_assessment.summary}`
    });
    for (const c of r.category_assessments ?? []) {
      facts.push({ id: `risk:${c.category}`, text: `${c.category}: ${c.level}. ${c.summary}` });
    }
    for (const f of r.risk_factors ?? []) {
      facts.push({
        id: `risk_factor:${f.id}`,
        text: `${f.id} ${f.title} (${f.category}, ${f.level}): ${f.interpretation}`
      });
    }
    (r.recommendations ?? []).forEach((rec, i) => {
      facts.push({ id: `recommendation:${i + 1}`, text: `Recommendation: ${rec.text}` });
    });
    for (const l of r.limitations ?? []) facts.push({ id: "limitation", text: `Limitation: ${l}` });
  }
  return facts;
}


// ============================================================
// PROMPT
// ============================================================

function buildChatPrompt(question, history, reportFacts, knowledge) {
  return `
You are the Risk Advisor Chatbot of FinRisk, a financial risk assessment system.
You speak like a careful financial analyst explaining an analysis to a colleague.

Answer the user's question using ONLY the CONTEXT below.
Rules:
- If the context does not contain the answer, say so plainly. Do not guess.
- Do not invent numbers or benchmarks. Quote values exactly as they appear in the context.
- Do not perform new calculations.
- Do not give personal investment, trading or credit advice; explain the analysis instead.
- Be concise: 2-6 sentences, plain language suitable for a student.
- Cite the ids of the context items you used in "sources".

CONTEXT — REPORT RESULTS:
${reportFacts.length ? reportFacts.map((f) => `[${f.id}] ${f.text}`).join("\n") : "(no report selected)"}

CONTEXT — KNOWLEDGE BASE:
${knowledge.length ? knowledge.map((k) => `[${k.id}] ${k.title}: ${k.content}`).join("\n") : "(nothing relevant found)"}

CONVERSATION SO FAR:
${history.length ? history.map((h) => `${h.role}: ${h.content}`).join("\n") : "(none)"}

USER QUESTION:
${question}

Return ONLY valid JSON:
{ "answer": "your answer", "sources": ["ratio:current_ratio", "K-LIQ-01"] }
`.trim();
}


// ============================================================
// RULE-BASED FALLBACK ANSWER
// ============================================================

function fallbackAnswer(question, reportFacts, knowledge) {
  const qTokens = new Set(tokenize(question));

  // Report facts that share words with the question. A ratio whose
  // full name appears in the question (e.g. "quick ratio") ranks first.
  const scored = reportFacts
    .map((f) => {
      const overlap = new Set(tokenize(f.text).filter((t) => qTokens.has(t))).size;
      const ratioName = f.id.startsWith("ratio:") ? tokenize(f.text.split(" = ")[0]) : [];
      const namesRatio = ratioName.length > 0 && ratioName.every((t) => qTokens.has(t));
      return { f, score: overlap + (namesRatio ? 5 : 0) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  // Skip facts that repeat an interpretation already included
  // (a category summary and its risk factor often share text).
  const lines = [];
  const used = [];
  for (const { f } of scored) {
    const body = f.text.slice(f.text.indexOf(":") + 1).trim().slice(0, 80);
    if (lines.some((l) => l.includes(body))) continue;
    lines.push(f.text);
    used.push(f);
  }
  if (knowledge[0]) lines.push(`${knowledge[0].title}: ${knowledge[0].content}`);

  if (!lines.length) {
    return {
      answer:
        "The language model is unavailable right now, and I could not find anything in the report or knowledge base that matches your question. Try asking about a specific ratio (for example the current ratio) or a risk category.",
      sources: []
    };
  }

  return {
    answer:
      "The language model is unavailable, so here are the most relevant facts I found:\n\n" +
      lines.map((l) => `- ${l}`).join("\n"),
    sources: [...used.map((f) => f.id), ...(knowledge[0] ? [knowledge[0].id] : [])]
  };
}


// ============================================================
// MAIN
// ============================================================

export async function answerQuestion({ question, history = [], report = null, companyId = null }) {
  const q = String(question ?? "").trim().slice(0, MAX_QUESTION_CHARS);
  if (!q) throw new Error("Question is empty");

  const cleanHistory = (Array.isArray(history) ? history : [])
    .filter((h) => h && ["user", "assistant"].includes(h.role) && typeof h.content === "string")
    .slice(-MAX_HISTORY_TURNS)
    .map((h) => ({ role: h.role, content: h.content.slice(0, 1500) }));

  const reportFacts = buildReportContext(report);
  // Global knowledge + the user's own company knowledge only.
  const knowledge = await searchKnowledge(q, { companyId });
  const validIds = new Set([...reportFacts.map((f) => f.id), ...knowledge.map((k) => k.id)]);

  const contextUsed = {
    knowledge: knowledge.map(({ id, title, document_title, scope, source, score }) => ({
      id, title, document_title, scope, source, score
    })),
    report_facts: reportFacts.length
  };

  try {
    const { data, model, provider } = await generateJson(
      buildChatPrompt(q, cleanHistory, reportFacts, knowledge),
      { label: "Chatbot" }
    );
    const answer = typeof data?.answer === "string" ? data.answer.trim() : "";
    if (!answer) throw new Error("LLM returned no answer");

    return {
      answer,
      sources: (Array.isArray(data.sources) ? data.sources : []).filter((s) => validIds.has(s)),
      generated_by: { method: "llm", provider, model },
      context: contextUsed
    };
  } catch (error) {
    if (!isFallbackEnabled()) throw error;
    console.warn(`[Chatbot] LLM unavailable, using retrieval-only answer: ${error.message}`);
    return {
      ...fallbackAnswer(q, reportFacts, knowledge),
      generated_by: { method: "rule_based", llm_error: error.message },
      context: contextUsed
    };
  }
}
