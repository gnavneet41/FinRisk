// ============================================================
// FinRisk offline end-to-end test
//   npm test
// Uses the real PDF extraction, validation, calculation engine,
// knowledge base, report generator and storage.
// The LLM is replaced by fake replies (including bad output on
// purpose), and a second run checks the no-LLM fallback.
// Nothing is sent to Gemini.
// ============================================================

import fs from "fs";
import os from "os";
import path from "path";
import assert from "assert";

process.env.FINRISK_REPORTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "finrisk-test-"));
process.env.LLM_PROVIDER = "gemini";
process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_MODEL = "test-model";

const realFetch = globalThis.fetch;

// ---------- fake LLM replies ----------
const analysisReply = {
  analysis_categories: ["liquidity_analysis", "solvency_analysis", "profitability_analysis",
    "efficiency_analysis", "cash_flow_analysis", "cash_flow_statement_analysis", "made_up_category"],
  selected_calculations: ["current_ratio", "quick_ratio", "cash_ratio", "debt_to_equity", "debt_ratio",
    "liabilities_to_assets", "gross_margin", "operating_margin", "net_profit_margin", "return_on_assets",
    "return_on_equity", "asset_turnover", "inventory_turnover", "receivables_turnover",
    "cfo_to_current_liabilities", "interest_coverage", "__proto__", "process.exit(1)"],
  observations: [
    { key: "operating_cash_flow", value: "999999", reason: "Positive operating cash flow.", severity: "high" },
    { key: "interest_expense", value: "5000", reason: "Invented value" }
  ],
  unavailable_calculations: [{ calculation: "interest_coverage", missing_keys: ["interest_expense"] }]
};

const riskReply = {
  risk_factors: [
    { id: "RF1", category: "liquidity_risk", title: "Current liabilities exceed current assets", level: "moderate",
      evidence: [{ type: "ratio", key: "current_ratio" }, { type: "data", key: "operating_cash_flow" }, { type: "ratio", key: "made_up_ratio" }],
      knowledge_refs: ["K-LIQ-01", "K-FAKE-99"],
      interpretation: "Current ratio of 0.8673 shows a shortfall of 23,405 million, mitigated by operating cash flow of 118,254." },
    { id: "RF2", category: "solvency_risk", title: "No evidence", level: "high", evidence: [{ type: "data", key: "interest_expense" }] },
    { id: "RF3", category: "solvency_risk", title: "Bad level", level: "catastrophic", evidence: [{ type: "ratio", key: "debt_to_equity" }] }
  ],
  category_assessments: [{ category: "liquidity_risk", level: "moderate", summary: "ok" }, { category: "fake_risk", level: "low", summary: "x" }],
  overall_assessment: { level: "moderate", summary: "Moderate overall, ROE of 164.59%.", key_drivers: ["RF1", "RF2"] },
  recommendations: [{ text: "Monitor liquidity.", related_risk_factors: ["RF1", "RF9"] }, "Obtain industry benchmarks."],
  limitations: ["Single fiscal year."],
  benchmarks_unavailable: ["Industry current ratio"]
};

const chatReply = { answer: "The current ratio is 0.8673.", sources: ["ratio:current_ratio", "K-LIQ-01", "made-up-source"] };

let llmCalls = 0;
globalThis.fetch = async (url, opts) => {
  if (!String(url).includes("generativelanguage")) return realFetch(url, opts);
  llmCalls++;
  assert.equal(opts.headers["x-goog-api-key"], "test-key");
  const prompt = JSON.parse(opts.body).contents[0].parts[0].text;
  const reply = prompt.startsWith("You are the Risk Advisor Agent") ? riskReply
    : prompt.startsWith("You are the Risk Advisor Chatbot") ? chatReply
    : analysisReply;
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } });
};

// ---------- start the app ----------
const { default: app } = await import("../src/app.js");
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;

const api = async (method, url, body) => {
  const r = await realFetch(base + url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const type = r.headers.get("content-type") ?? "";
  return { status: r.status, body: type.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) };
};

async function upload(file, name, type, query = "") {
  const form = new FormData();
  form.append("document", new Blob([fs.readFileSync(file)], { type }), name);
  const r = await realFetch(`${base}/api/documents/upload${query}`, { method: "POST", body: form });
  return { status: r.status, body: await r.json() };
}

const pass = (msg) => console.log(`PASS ${msg}`);
const PDF = "test/fixtures/apple.pdf";

try {
  // ======================= 1. Document Agent =======================
  let r = await upload(PDF, "Apple.pdf", "application/pdf");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const reportId = r.body.report.id;
  assert.equal(r.body.report.status, "extracted");
  assert.equal(r.body.report.financial_data.company, "Apple Inc.");
  assert.equal(r.body.report.financial_data.revenue, 391035);
  assert.equal(r.body.report.validation.is_valid, true);
  assert.equal(llmCalls, 0, "upload must not call the LLM");
  pass("Document Agent: upload extracts and validates without any LLM call");

  // ======================= 2. Analysis pipeline with LLM =======================
  r = await api("POST", `/api/reports/${reportId}/analyze`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 500));
  const rep = r.body.report;
  const expected = { current_ratio: 0.8673, quick_ratio: 0.5589, cash_ratio: 0.3695, debt_to_equity: 1.8723,
    debt_ratio: 0.2922, liabilities_to_assets: 0.844, gross_margin: 46.21, operating_margin: 31.51,
    net_profit_margin: 23.97, return_on_assets: 25.68, return_on_equity: 164.59, asset_turnover: 1.0714,
    inventory_turnover: 28.8707, receivables_turnover: 11.7041, cfo_to_current_liabilities: 0.6704 };
  for (const [k, v] of Object.entries(expected)) assert.equal(rep.analysis.calculated_ratios[k].value, v, k);
  assert.equal(rep.analysis_plan.generated_by.method, "llm");
  assert.deepEqual(rep.analysis_plan.rejected_calculations.map((x) => x.calculation), ["__proto__", "process.exit(1)"]);
  assert.deepEqual(rep.analysis.observations, [{ key: "operating_cash_flow", value: "118254", reason: "Positive operating cash flow." }]);
  pass("Analysis Agent + Calculation Engine: 15/15 ratios match, unsafe LLM output filtered");

  const ra = rep.risk_assessment;
  assert.equal(ra.generated_by.method, "llm");
  assert.deepEqual(ra.risk_factors.map((f) => f.id), ["RF1"]);
  assert.equal(ra.risk_factors[0].evidence[0].value, 0.8673);
  assert.deepEqual(ra.risk_factors[0].knowledge_refs, ["K-LIQ-01"]);
  assert.deepEqual(ra.overall_assessment.key_drivers, ["RF1"]);
  assert.ok(ra.limitations.some((l) => l.includes("interest_coverage")));
  const note = ra.validation_notes.find((n) => n.startsWith("Numbers in the narrative"));
  assert.ok(note?.includes("23,405") && !note.includes("164.59") && !note.includes("118,254"), note);
  pass("Risk Advisor: claims without evidence dropped, invented number flagged");

  // ======================= 3. Report Generator =======================
  assert.equal(rep.status, "completed");
  assert.equal(rep.pdf_url, `/api/reports/${reportId}/pdf`);
  r = await api("GET", rep.pdf_url);
  assert.equal(r.status, 200);
  assert.equal(r.body.subarray(0, 5).toString(), "%PDF-");
  fs.writeFileSync("test/last-report.pdf", r.body);
  pass(`Report Generator: PDF downloaded (${Math.round(r.body.length / 1024)} KB, saved to test/last-report.pdf)`);

  // ======================= 4. Chatbot with LLM =======================
  r = await api("POST", "/api/chat", { question: "What is the current ratio?", report_id: reportId });
  assert.equal(r.status, 200);
  assert.equal(r.body.answer, "The current ratio is 0.8673.");
  assert.deepEqual(r.body.sources, ["ratio:current_ratio", "K-LIQ-01"]);
  assert.ok(r.body.context.knowledge.length > 0);
  pass("Chatbot: answer returned, invented source removed");

  // ======================= 5. Reports list / get =======================
  r = await api("GET", "/api/reports");
  assert.equal(r.body.reports[0].id, reportId);
  assert.equal(r.body.reports[0].overall_level, "moderate");
  r = await api("GET", `/api/reports/${reportId}`);
  assert.equal(r.status, 200);
  pass("Report history: list and fetch work");

  // ======================= 6. No LLM -> rule-based fallback =======================
  delete process.env.GEMINI_API_KEY;
  delete process.env.LLM_PROVIDER;
  const callsBefore = llmCalls;
  r = await upload(PDF, "Apple.pdf", "application/pdf", "?analyze=true");
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 500));
  const fb = r.body.report;
  assert.equal(llmCalls, callsBefore, "fallback must not call the LLM");
  assert.equal(fb.analysis_plan.generated_by.method, "rule_based");
  assert.equal(Object.keys(fb.analysis.calculated_ratios).length, 15);
  assert.equal(fb.risk_assessment.generated_by.method, "rule_based");
  const levels = Object.fromEntries(fb.risk_assessment.category_assessments.map((c) => [c.category, c.level]));
  assert.deepEqual(levels, { liquidity_risk: "moderate", solvency_risk: "moderate", profitability_risk: "low", cash_flow_risk: "low" });
  assert.equal(fb.risk_assessment.overall_assessment.level, "moderate");
  assert.ok(fb.pdf_url);
  fs.writeFileSync("test/last-report-fallback.pdf", (await api("GET", fb.pdf_url)).body);
  pass(`Fallback (no LLM): full pipeline works, overall ${fb.risk_assessment.overall_assessment.level}, PDF generated`);

  r = await api("POST", "/api/chat", { question: "Why is the quick ratio low?", report_id: fb.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.generated_by.method, "rule_based");
  assert.ok(r.body.answer.includes("Quick Ratio = 0.5589"), r.body.answer);
  pass("Fallback chatbot: retrieval-only answer cites the quick ratio");

  // ======================= 7. Corrections + errors =======================
  r = await api("POST", `/api/reports/${fb.id}/analyze`, { financial_data: { inventory: "abc" } });
  assert.equal(r.status, 422);
  r = await api("POST", `/api/reports/${fb.id}/analyze`, { financial_data: { total_equity: "60,000", not_a_field: 1 } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.report.corrected_fields, [{ key: "total_equity", extracted: 56950, corrected: 60000 }]);
  assert.equal(r.body.report.analysis.calculated_ratios.debt_to_equity.value, 1.7772);
  pass("Corrections: invalid value rejected, corrected value recalculated, unknown key ignored");

  r = await upload("package.json", "x.txt", "text/plain");
  assert.equal(r.status, 415);
  r = await realFetch(`${base}/api/documents/upload`, { method: "POST" });
  assert.equal(r.status, 400);
  assert.equal((await api("GET", "/api/reports/..%2F..%2Fpackage")).status, 404);
  assert.equal((await api("POST", "/api/chat", {})).status, 400);
  assert.equal((await api("GET", "/api/nope")).status, 404);
  r = await api("GET", "/api/health");
  assert.equal(r.body.llm.provider, "none");
  assert.ok(!JSON.stringify(r.body).includes("test-key"));
  pass("Errors: unsupported file, no file, bad report id, empty question, unknown route");

  console.log("\nAll tests passed.");
} finally {
  server.close();
  fs.rmSync(process.env.FINRISK_REPORTS_DIR, { recursive: true, force: true });
}
