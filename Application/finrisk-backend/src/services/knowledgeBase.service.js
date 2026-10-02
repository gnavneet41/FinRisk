// ============================================================
// RAG KNOWLEDGE BASE
// ------------------------------------------------------------
// Knowledge sources:
//   1. knowledge/risk_knowledge.json   (curated interpretation rules)
//   2. knowledge/docs/*.md, *.txt      (any reference notes you add;
//                                       split into paragraph chunks)
//
// Pipeline (matches the RAG diagram, without a vector database):
//   documents -> chunking -> BM25 index (in memory) -> retriever
//
// BM25 is a standard keyword-ranking algorithm used by search
// engines. It needs no API calls, so retrieval keeps working when
// the LLM is busy. Embeddings + a vector DB can replace the index
// later; callers only use retrieveKnowledge() and searchKnowledge().
// ============================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.join(__dirname, "..", "..", "knowledge");
const KNOWLEDGE_FILE = path.join(KNOWLEDGE_DIR, "risk_knowledge.json");
const DOCS_DIR = path.join(KNOWLEDGE_DIR, "docs");

const MAX_CHUNK_CHARS = 900;
const MAX_RISK_ENTRIES = 15;

const STOPWORDS = new Set(
  ("a an and are as at be by can for from has have how i if in is it its of on or " +
   "that the this to was what when which who why will with does do my our their " +
   "than then so not no should would could about into also").split(" ")
);

let index = null; // built once, on first use


// ============================================================
// LOADING + CHUNKING
// ============================================================

function loadDocuments() {
  const docs = [];

  // 1. Curated entries
  const parsed = JSON.parse(fs.readFileSync(KNOWLEDGE_FILE, "utf8"));
  if (!Array.isArray(parsed.entries)) {
    throw new Error("knowledge/risk_knowledge.json must contain an 'entries' array");
  }
  for (const e of parsed.entries) {
    docs.push({
      id: e.id,
      title: e.title,
      content: e.content,
      source: e.source,
      risk_category: e.risk_category ?? null,
      applies_to: e.applies_to ?? [],
      benchmark: e.benchmark ?? null,
      kind: "rule"
    });
  }

  // 2. Reference documents (optional folder)
  if (fs.existsSync(DOCS_DIR)) {
    const files = fs.readdirSync(DOCS_DIR)
      .filter((f) => /\.(md|txt)$/i.test(f) && f.toLowerCase() !== "readme.md")
      .sort();

    for (const file of files) {
      const text = fs.readFileSync(path.join(DOCS_DIR, file), "utf8");
      chunkText(text).forEach((chunk, i) => {
        docs.push({
          id: `DOC-${path.parse(file).name}-${i + 1}`,
          title: chunk.heading || file,
          content: chunk.text,
          source: `knowledge/docs/${file}`,
          risk_category: null,
          applies_to: [],
          benchmark: null,
          kind: "document"
        });
      });
    }
  }

  return docs;
}

/** Splits text into chunks at paragraph boundaries, keeping the last heading. */
export function chunkText(text) {
  const chunks = [];
  let heading = "";
  let current = "";

  const flush = () => {
    if (current.trim()) chunks.push({ heading, text: current.trim() });
    current = "";
  };

  for (const block of text.replace(/\r/g, "").split(/\n\s*\n/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/m);
    if (headingMatch && trimmed.startsWith("#")) {
      flush();
      heading = headingMatch[1].trim();
      const rest = trimmed.replace(/^#{1,6}\s+.+$/m, "").trim();
      if (rest) current = rest;
      continue;
    }

    if ((current + "\n\n" + trimmed).length > MAX_CHUNK_CHARS) flush();
    current = current ? `${current}\n\n${trimmed}` : trimmed;
  }
  flush();
  return chunks;
}


// ============================================================
// BM25 INDEX
// ============================================================

export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/_/g, " ")              // current_ratio -> current ratio
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function buildIndex() {
  const docs = loadDocuments();
  const docTokens = docs.map((d) =>
    tokenize(`${d.title} ${d.title} ${d.applies_to.join(" ")} ${d.content}`)
  );

  const df = new Map();
  for (const tokens of docTokens) {
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const avgLength = docTokens.reduce((s, t) => s + t.length, 0) / Math.max(docs.length, 1);
  const termFreqs = docTokens.map((tokens) => {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    return tf;
  });

  console.log(
    `[Knowledge Base] Indexed ${docs.length} chunks ` +
    `(${docs.filter((d) => d.kind === "rule").length} rules, ` +
    `${docs.filter((d) => d.kind === "document").length} document chunks)`
  );

  return { docs, docTokens, termFreqs, df, avgLength };
}

function getIndex() {
  if (!index) index = buildIndex();
  return index;
}

/** Rebuild after adding files to knowledge/ (also used by tests). */
export function reloadKnowledge() {
  index = null;
  return getIndex().docs.length;
}

function bm25Scores(query) {
  const { docs, docTokens, termFreqs, df, avgLength } = getIndex();
  const k1 = 1.5;
  const b = 0.75;
  const queryTerms = [...new Set(tokenize(query))];

  return docs.map((doc, i) => {
    let score = 0;
    for (const term of queryTerms) {
      const freq = termFreqs[i].get(term);
      if (!freq) continue;
      const n = df.get(term);
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += idf * (freq * (k1 + 1)) /
        (freq + k1 * (1 - b + (b * docTokens[i].length) / avgLength));
    }
    return { doc, score };
  });
}

function toResult(doc, extra = {}) {
  return {
    id: doc.id,
    title: doc.title,
    kind: doc.kind,
    risk_category: doc.risk_category,
    content: doc.content,
    benchmark: doc.benchmark,
    source: doc.source,
    ...extra
  };
}


// ============================================================
// PUBLIC RETRIEVERS
// ============================================================

/**
 * Free-text search (used by the chatbot).
 */
export function searchKnowledge(query, limit = 5) {
  return bm25Scores(query)
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ doc, score }) => toResult(doc, { score: Number(score.toFixed(3)) }));
}

/**
 * Retrieval for the Risk Advisor.
 * 1. Rules whose "applies_to" matches the analysis (exact match).
 * 2. Plus the best document chunks for a query built from the analysis.
 */
export function retrieveKnowledge(analysis) {
  const { docs } = getIndex();

  const terms = new Set([
    ...Object.keys(analysis.calculated_ratios ?? {}),
    ...(analysis.observations ?? []).map((o) => o.key),
    ...(analysis.analysis_categories ?? []),
    ...(analysis.unavailable_calculations ?? []).flatMap((u) => [
      u.calculation,
      ...(u.missing_keys ?? [])
    ])
  ]);

  const ruleMatches = [];
  for (const doc of docs.filter((d) => d.kind === "rule")) {
    const matched = doc.applies_to.filter((t) => terms.has(t));
    const general = doc.applies_to.includes("*");
    if (matched.length || general) {
      ruleMatches.push({ doc, matched, score: matched.length + (general ? 0.5 : 0) });
    }
  }
  ruleMatches.sort((a, b) => b.score - a.score);

  const results = ruleMatches
    .slice(0, MAX_RISK_ENTRIES)
    .map(({ doc, matched }) => toResult(doc, { matched_terms: matched }));

  // Add up to 3 reference-document chunks.
  const query = [...terms].join(" ");
  const docChunks = bm25Scores(query)
    .filter((r) => r.doc.kind === "document" && r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ doc }) => toResult(doc, { matched_terms: ["text search"] }));

  return [...results, ...docChunks];
}
