// ============================================================
// RAG KNOWLEDGE BASE  (MongoDB)
// ------------------------------------------------------------
//                 Knowledge Base
//                       |
//              +--------+--------+
//              |                 |
//           GLOBAL            COMPANY (private)
//        admin manages       company analysts manage
//        all companies       only that company's users
//
// Retrieval for a company always uses GLOBAL + THAT company's
// private knowledge, never another company's.
//
// Pipeline: documents -> chunking -> BM25 index (in memory,
// cached per company) -> retriever. BM25 is a keyword ranking
// algorithm; it needs no API calls, so it keeps working when the
// LLM is busy. Embeddings can replace it later behind the same
// two functions: retrieveKnowledge() and searchKnowledge().
// ============================================================

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import KnowledgeDocument from "../models/KnowledgeDocument.js";
import { getConfig } from "./systemConfig.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.join(__dirname, "..", "..", "knowledge");

const STOPWORDS = new Set(
  ("a an and are as at be by can for from has have how i if in is it its of on or " +
   "that the this to was what when which who why will with does do my our their " +
   "than then so not no should would could about into also").split(" ")
);

const indexCache = new Map(); // key: company id or "global"


// ============================================================
// CHUNKING
// ============================================================

/** Splits text into chunks at headings and blank lines. */
export function chunkText(text, maxChars = getConfig("rag").chunk_size_chars) {
  const chunks = [];
  let heading = "";
  let current = "";

  const flush = () => {
    if (current.trim()) chunks.push({ heading, text: current.trim() });
    current = "";
  };

  for (const block of String(text).replace(/\r/g, "").split(/\n\s*\n/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    if (/^#{1,6}\s+/.test(trimmed)) {
      flush();
      const [first, ...rest] = trimmed.split("\n");
      heading = first.replace(/^#{1,6}\s+/, "").trim();
      if (rest.join("\n").trim()) current = rest.join("\n").trim();
      continue;
    }

    if (current && (current + "\n\n" + trimmed).length > maxChars) flush();
    // A single very long paragraph is split by sentences.
    if (trimmed.length > maxChars) {
      let piece = "";
      for (const sentence of trimmed.split(/(?<=[.!?])\s+/)) {
        if ((piece + " " + sentence).length > maxChars && piece) {
          chunks.push({ heading, text: piece.trim() });
          piece = "";
        }
        piece += " " + sentence;
      }
      current = piece.trim();
      continue;
    }
    current = current ? `${current}\n\n${trimmed}` : trimmed;
  }
  flush();
  return chunks;
}

export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/_/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}


// ============================================================
// CREATE / UPDATE (used by the knowledge routes and seeding)
// ============================================================

export function buildChunks(content, prefix) {
  const id = crypto.randomBytes(3).toString("hex");
  return chunkText(content).map((c, i) => ({
    chunk_id: `${prefix}-${id}-${i + 1}`,
    heading: c.heading,
    text: c.text,
    applies_to: []
  }));
}

export async function createKnowledgeDocument(fields) {
  const prefix = fields.scope === "global" ? "G" : "C";
  const doc = await KnowledgeDocument.create({
    ...fields,
    chunks: fields.chunks ?? buildChunks(fields.content ?? "", prefix)
  });
  invalidateKnowledgeCache();
  return doc;
}

export function invalidateKnowledgeCache() {
  indexCache.clear();
}


// ============================================================
// INDEX
// ============================================================

async function loadChunks(companyId) {
  const includeCompany = companyId && getConfig("rag").include_company_knowledge;
  const filter = includeCompany
    ? { is_active: true, $or: [{ scope: "global" }, { scope: "company", company: companyId }] }
    : { is_active: true, scope: "global" };

  const docs = await KnowledgeDocument.find(filter).select("scope title source category chunks").lean();

  const chunks = [];
  for (const d of docs) {
    for (const c of d.chunks ?? []) {
      chunks.push({
        id: c.chunk_id,
        title: c.heading || d.title,
        document_title: d.title,
        document_id: d._id.toString(),
        scope: d.scope,
        category: d.category,
        source: d.source || d.title,
        content: c.text,
        applies_to: c.applies_to ?? [],
        kind: (c.applies_to ?? []).length ? "rule" : "document"
      });
    }
  }
  return chunks;
}

async function getIndex(companyId) {
  const key = companyId ? String(companyId) : "global";
  if (indexCache.has(key)) return indexCache.get(key);

  const docs = await loadChunks(companyId);
  const docTokens = docs.map((d) =>
    tokenize(`${d.title} ${d.title} ${d.document_title} ${d.applies_to.join(" ")} ${d.content}`)
  );
  const df = new Map();
  for (const tokens of docTokens) for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  const termFreqs = docTokens.map((tokens) => {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    return tf;
  });
  const avgLength = docTokens.reduce((s, t) => s + t.length, 0) / Math.max(docs.length, 1);

  const index = { docs, docTokens, termFreqs, df, avgLength };
  indexCache.set(key, index);
  return index;
}

function bm25(index, query) {
  const { docs, docTokens, termFreqs, df, avgLength } = index;
  const k1 = 1.5;
  const b = 0.75;
  const terms = [...new Set(tokenize(query))];
  return docs.map((doc, i) => {
    let score = 0;
    for (const term of terms) {
      const freq = termFreqs[i].get(term);
      if (!freq) continue;
      const n = df.get(term);
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += idf * (freq * (k1 + 1)) / (freq + k1 * (1 - b + (b * docTokens[i].length) / avgLength));
    }
    return { doc, score };
  });
}

const toResult = (doc, extra = {}) => ({
  id: doc.id,
  title: doc.title,
  document_title: doc.document_title,
  scope: doc.scope,
  kind: doc.kind,
  category: doc.category,
  content: doc.content,
  source: doc.source,
  ...extra
});


// ============================================================
// RETRIEVERS
// ============================================================

/** Free-text search (chatbot). */
export async function searchKnowledge(query, { companyId = null, limit } = {}) {
  const index = await getIndex(companyId);
  const top = limit ?? getConfig("rag").chat_top_k;
  return bm25(index, query)
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, top)
    .map(({ doc, score }) => toResult(doc, { score: Number(score.toFixed(3)) }));
}

/**
 * Retrieval for the Risk Advisor:
 *  1. rule chunks whose applies_to matches the analysis (exact match)
 *  2. plus the best text chunks (global + company) for the analysis terms
 */
export async function retrieveKnowledge(analysis, { companyId = null } = {}) {
  const rag = getConfig("rag");
  const index = await getIndex(companyId);

  const terms = new Set([
    ...Object.keys(analysis.calculated_ratios ?? {}),
    ...(analysis.observations ?? []).map((o) => o.key),
    ...(analysis.analysis_categories ?? []),
    ...(analysis.unavailable_calculations ?? []).flatMap((u) => [u.calculation, ...(u.missing_keys ?? [])])
  ]);

  const rules = [];
  for (const doc of index.docs.filter((d) => d.kind === "rule")) {
    const matched = doc.applies_to.filter((t) => terms.has(t));
    const general = doc.applies_to.includes("*");
    if (matched.length || general) rules.push({ doc, matched, score: matched.length + (general ? 0.5 : 0) });
  }
  rules.sort((a, b) => b.score - a.score);

  const results = rules
    .slice(0, rag.max_rule_entries)
    .map(({ doc, matched }) => toResult(doc, { matched_terms: matched }));

  const textChunks = bm25(index, [...terms].join(" "))
    .filter((r) => r.doc.kind === "document" && r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, rag.max_document_chunks)
    .map(({ doc }) => toResult(doc, { matched_terms: ["text search"] }));

  return [...results, ...textChunks];
}


// ============================================================
// SEEDING THE GLOBAL KNOWLEDGE BASE
// ============================================================

const SEED_DOCS = [
  {
    file: "sec_financial_statements_guide.md",
    title: "SEC Financial Statements Guide",
    category: "regulatory_guidance",
    source: "U.S. SEC, Beginners' Guide to Financial Statements (FinRisk summary)"
  },
  {
    file: "ifrs_conceptual_framework.md",
    title: "IFRS Conceptual Framework",
    category: "accounting_standards",
    source: "IASB Conceptual Framework for Financial Reporting, 2018 (FinRisk summary)"
  },
  {
    file: "ias_1_presentation.md",
    title: "IAS 1 Presentation of Financial Statements",
    category: "accounting_standards",
    source: "IAS 1, IFRS Foundation (FinRisk summary)"
  },
  {
    file: "basel_risk_guidance.md",
    title: "Basel Risk Guidance",
    category: "regulatory_guidance",
    source: "Basel Committee on Banking Supervision, Basel III (FinRisk summary)"
  },
  {
    file: "ratio_definitions.md",
    title: "Financial Ratio Definitions",
    category: "ratio_definitions",
    source: "FinRisk Calculation Engine formulas"
  }
];

/** Creates the global knowledge documents if the global KB is empty. */
export async function seedGlobalKnowledge() {
  if (await KnowledgeDocument.exists({ scope: "global" })) return 0;

  // 1. Curated interpretation rules: one document, one chunk per rule,
  //    keeping their ids (K-LIQ-01 ...) and applies_to lists.
  const rules = JSON.parse(fs.readFileSync(path.join(KNOWLEDGE_DIR, "risk_knowledge.json"), "utf8"));
  await KnowledgeDocument.create({
    scope: "global",
    title: "FinRisk Ratio Interpretation Guide",
    category: "risk_methodology",
    source: "FinRisk methodology (add textbook citations before submission)",
    description: "How to interpret each ratio, including mitigating factors. Contains no industry benchmarks.",
    content: rules.entries.map((e) => `## ${e.title}\n\n${e.content}`).join("\n\n"),
    chunks: rules.entries.map((e) => ({
      chunk_id: e.id,
      heading: e.title,
      text: e.content,
      applies_to: e.applies_to ?? []
    }))
  });

  // 2. Reference documents
  for (const d of SEED_DOCS) {
    const content = fs.readFileSync(path.join(KNOWLEDGE_DIR, "docs", d.file), "utf8");
    const key = path.parse(d.file).name;
    await KnowledgeDocument.create({
      scope: "global",
      title: d.title,
      category: d.category,
      source: d.source,
      description: content.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.slice(0, 240) ?? "",
      content,
      chunks: chunkText(content).map((c, i) => ({
        chunk_id: `DOC-${key}-${i + 1}`,
        heading: c.heading,
        text: c.text,
        applies_to: []
      }))
    });
  }

  invalidateKnowledgeCache();
  return SEED_DOCS.length + 1;
}


// ============================================================
// HISTORICAL REPORTS -> COMPANY KNOWLEDGE
// ============================================================

/** Saves a completed analysis as private company knowledge. */
export async function saveHistoricalReport(doc) {
  const a = doc.analysis;
  const r = doc.risk_assessment;
  if (!a || !r) return;

  const ratios = Object.values(a.calculated_ratios)
    .map((x) => `${x.name}: ${x.value}${x.unit === "percent" ? "%" : ""}`)
    .join("; ");
  const content = [
    `# ${a.company ?? "Company"} ${a.fiscal_year ?? ""} risk assessment`,
    `Overall risk level: ${r.overall_assessment.level}. ${r.overall_assessment.summary}`,
    "## Ratios",
    ratios,
    "## Risk by category",
    ...r.category_assessments.map((c) => `${c.category}: ${c.level}. ${c.summary}`),
    "## Recommendations",
    ...r.recommendations.map((x) => `- ${x.text}`)
  ].join("\n\n");

  await KnowledgeDocument.deleteMany({ scope: "company", source_document: doc._id });
  await createKnowledgeDocument({
    scope: "company",
    company: doc.company,
    title: `Historical report: ${a.company ?? doc.filename} ${a.fiscal_year ?? ""}`.trim(),
    category: "historical_report",
    source: `FinRisk analysis of ${doc.filename}`,
    description: `Overall risk ${r.overall_assessment.level}. Generated automatically when the analysis completed.`,
    content,
    source_document: doc._id
  });
}
