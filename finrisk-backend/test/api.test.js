// ============================================================
// FinRisk end-to-end API test (needs a running MongoDB)
//   npm test
// Uses database "finrisk_test" (dropped at the start), the real
// extraction / calculation / knowledge / PDF code, and fake LLM
// replies. Nothing is sent to Gemini.
// ============================================================

import fs from "fs";
import os from "os";
import path from "path";
import assert from "assert";

process.env.FINRISK_REPORTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "finrisk-reports-"));
process.env.FINRISK_UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "finrisk-uploads-"));
process.env.LLM_PROVIDER = "gemini";
process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_MODEL = "test-model";
process.env.ADMIN_EMAIL = "admin@test.local";
process.env.ADMIN_PASSWORD = "FirstAdmin#2026";
process.env.JWT_SECRET = "test-secret";
const MONGO_URI = process.env.FINRISK_TEST_MONGO_URI || "mongodb://127.0.0.1:27017/finrisk_test";

// ---------- fake LLM ----------
const realFetch = globalThis.fetch;
let llmCalls = 0;
const analysisReply = {
  analysis_categories: ["liquidity_analysis", "solvency_analysis", "profitability_analysis", "efficiency_analysis", "cash_flow_analysis"],
  selected_calculations: ["current_ratio", "quick_ratio", "cash_ratio", "debt_to_equity", "debt_ratio", "liabilities_to_assets",
    "gross_margin", "operating_margin", "net_profit_margin", "return_on_assets", "return_on_equity", "asset_turnover",
    "inventory_turnover", "receivables_turnover", "cfo_to_current_liabilities", "__proto__"],
  observations: [{ key: "operating_cash_flow", value: "1", reason: "Positive operating cash flow." }],
  unavailable_calculations: []
};
const riskReply = {
  risk_factors: [{ id: "RF1", category: "liquidity_risk", title: "Current liabilities exceed current assets", level: "moderate",
    evidence: [{ type: "ratio", key: "current_ratio" }], knowledge_refs: ["K-LIQ-01", "K-FAKE"],
    interpretation: "Current ratio of 0.8673." }],
  category_assessments: [{ category: "liquidity_risk", level: "moderate", summary: "Liquidity is tight." }],
  overall_assessment: { level: "moderate", summary: "Moderate.", key_drivers: ["RF1"] },
  recommendations: [{ text: "Monitor liquidity.", related_risk_factors: ["RF1"] }],
  limitations: [], benchmarks_unavailable: []
};
let lastChatPrompt = "";
globalThis.fetch = async (url, opts) => {
  if (!String(url).includes("generativelanguage")) return realFetch(url, opts);
  llmCalls++;
  const prompt = JSON.parse(opts.body).contents[0].parts[0].text;
  let reply = analysisReply;
  if (prompt.startsWith("You are the Risk Advisor Agent")) reply = riskReply;
  if (prompt.startsWith("You are the Risk Advisor Chatbot")) {
    lastChatPrompt = prompt;
    reply = { answer: "The current ratio is 0.8673.", sources: ["ratio:current_ratio", "made-up"] };
  }
  if (prompt.includes('{"status": "ok"}')) reply = { status: "ok" };
  return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(reply) }] } }] }), { status: 200 });
};

// ---------- start ----------
const mongoose = (await import("mongoose")).default;
const { connectDatabase } = await import("../src/config/db.js");
const { bootstrap } = await import("../src/services/bootstrap.service.js");
const { default: app } = await import("../src/app.js");

await connectDatabase(MONGO_URI);
await mongoose.connection.dropDatabase();
await bootstrap();
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;

async function api(method, url, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const r = await realFetch(base + url, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const type = r.headers.get("content-type") ?? "";
  return { status: r.status, body: type.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}
async function login(email, password) {
  const r = await api("POST", "/api/auth/login", { body: { email, password } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
async function loginAndSetPassword(email, temp, next) {
  const { token } = await login(email, temp);
  const r = await api("POST", "/api/auth/change-password", { token, body: { current_password: temp, new_password: next } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token;
}
function fileForm(file, name, type) {
  const form = new FormData();
  form.append("document", new Blob([fs.readFileSync(file)], { type }), name);
  return form;
}
async function waitForStatus(token, id, wanted = ["completed", "failed", "needs_review"]) {
  for (let i = 0; i < 100; i++) {
    const r = await api("GET", `/api/documents/${id}`, { token });
    if (wanted.includes(r.body.document.status)) return r.body.document;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error("Timed out waiting for the analysis");
}
const pass = (m) => console.log(`PASS ${m}`);
const PDF = "test/fixtures/apple.pdf";

try {
  // ===================== Admin bootstrap =====================
  let r = await api("POST", "/api/auth/login", { body: { email: "admin@test.local", password: "wrong" } });
  assert.equal(r.status, 401);
  const firstAdmin = await login("admin@test.local", "FirstAdmin#2026");
  assert.equal(firstAdmin.user.must_change_password, true);
  r = await api("GET", "/api/admin/users", { token: firstAdmin.token });
  assert.equal(r.body.code, "PASSWORD_CHANGE_REQUIRED");
  const admin = await loginAndSetPassword("admin@test.local", "FirstAdmin#2026", "AdminNew#2026");
  pass("Admin: created on first start, must change password before doing anything");

  // ===================== Companies + users =====================
  r = await api("POST", "/api/admin/companies", { token: admin, body: { name: "Alpha Ltd", subscription: { plan: "standard", max_users: 3, max_documents_per_month: 10 } } });
  assert.equal(r.status, 201);
  const alphaId = r.body.company.id;
  r = await api("POST", "/api/admin/companies", { token: admin, body: { name: "Beta Ltd" } });
  const betaId = r.body.company.id;

  r = await api("POST", "/api/admin/users", { token: admin, body: { name: "Ana", email: "ana@alpha.test", role: "analyst", company_id: alphaId } });
  assert.equal(r.status, 201);
  const anaId = r.body.user.id;
  const ana = await loginAndSetPassword("ana@alpha.test", r.body.temporary_password, "AnaPass#2026");
  r = await api("POST", "/api/admin/users", { token: admin, body: { name: "Val", email: "val@alpha.test", role: "viewer", company_id: alphaId } });
  const val = await loginAndSetPassword("val@alpha.test", r.body.temporary_password, "ValPass#2026");
  r = await api("POST", "/api/admin/users", { token: admin, body: { name: "Ben", email: "ben@beta.test", role: "analyst", company_id: betaId } });
  const ben = await loginAndSetPassword("ben@beta.test", r.body.temporary_password, "BenPass#2026");
  r = await api("POST", "/api/admin/users", { token: admin, body: { name: "X", email: "x@alpha.test", role: "analyst" } });
  assert.equal(r.status, 400); // company user without company
  r = await api("POST", "/api/admin/users", { token: admin, body: { name: "X", email: "x@alpha.test", role: "analyst", company_id: alphaId } });
  r = await api("POST", "/api/admin/users", { token: admin, body: { name: "Y", email: "y@alpha.test", role: "analyst", company_id: alphaId } });
  assert.equal(r.status, 409); // seat limit 3
  r = await api("GET", "/api/admin/users", { token: ana });
  assert.equal(r.status, 403);
  pass("Users: create with temporary password, role checks, seat limit, non-admins blocked");

  // ===================== Upload PDF -> completed =====================
  r = await api("POST", "/api/documents/upload", { token: ana, form: fileForm(PDF, "Apple.pdf", "application/pdf") });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.document.status, "analyzing");
  assert.deepEqual(r.body.document.status_history.map((s) => s.status), ["uploaded", "extracted", "validated", "analyzing"]);
  let doc = await waitForStatus(ana, r.body.document.id);
  assert.equal(doc.status, "completed", JSON.stringify(doc.error));
  const expected = { current_ratio: 0.8673, quick_ratio: 0.5589, cash_ratio: 0.3695, debt_to_equity: 1.8723, debt_ratio: 0.2922,
    liabilities_to_assets: 0.844, gross_margin: 46.21, operating_margin: 31.51, net_profit_margin: 23.97, return_on_assets: 25.68,
    return_on_equity: 164.59, asset_turnover: 1.0714, inventory_turnover: 28.8707, receivables_turnover: 11.7041, cfo_to_current_liabilities: 0.6704 };
  for (const [k, v] of Object.entries(expected)) assert.equal(doc.analysis.calculated_ratios[k].value, v, k);
  assert.equal(doc.analysis.observations[0].value, "118254");
  assert.deepEqual(doc.risk_assessment.risk_factors[0].knowledge_refs, ["K-LIQ-01"]);
  assert.equal(doc.risk_assessment.generated_by.method, "llm");
  const pdfDocId = doc.id;
  r = await api("GET", doc.pdf_url, { token: ana });
  assert.equal(r.body.subarray(0, 5).toString(), "%PDF-");
  pass("PDF upload: uploaded -> extracted -> validated -> analyzing -> completed, 15/15 ratios, PDF report");

  // ===================== CSV + Excel =====================
  r = await api("GET", "/api/documents/templates/csv", { token: ana });
  const csvFile = path.join(os.tmpdir(), "apple.csv");
  fs.writeFileSync(csvFile, r.body);
  r = await api("GET", "/api/documents/templates/xlsx", { token: ana });
  const xlsxFile = path.join(os.tmpdir(), "apple.xlsx");
  fs.writeFileSync(xlsxFile, r.body);
  r = await api("POST", "/api/documents/upload", { token: ana, form: fileForm(csvFile, "apple.csv", "text/csv") });
  doc = await waitForStatus(ana, r.body.document.id);
  assert.equal(doc.analysis.calculated_ratios.current_ratio.value, 0.8673);
  r = await api("POST", "/api/documents/upload", { token: ana, form: fileForm(xlsxFile, "apple.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") });
  doc = await waitForStatus(ana, r.body.document.id);
  assert.equal(doc.analysis.calculated_ratios.return_on_equity.value, 164.59);
  pass("CSV and Excel uploads: same 30 values and ratios as the PDF");

  // ===================== needs_review + corrections =====================
  const partial = fs.readFileSync(csvFile, "utf8").split("\n").filter((l) => !l.startsWith("Revenue")).join("\n");
  const partialFile = path.join(os.tmpdir(), "partial.csv");
  fs.writeFileSync(partialFile, partial);
  r = await api("POST", "/api/documents/upload", { token: ana, form: fileForm(partialFile, "partial.csv", "text/csv") });
  assert.equal(r.body.document.status, "needs_review");
  r = await api("POST", `/api/documents/${r.body.document.id}/analyze`, { token: ana, body: { financial_data: { revenue: "391,035" } } });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  doc = await waitForStatus(ana, r.body.document.id);
  assert.equal(doc.status, "completed");
  assert.deepEqual(doc.corrected_fields, [{ key: "revenue", extracted: null, corrected: 391035 }]);
  pass("Needs review: missing revenue stops the pipeline, correction lets it complete");

  // ===================== Tenant isolation + roles =====================
  r = await api("GET", `/api/documents/${pdfDocId}`, { token: ben });
  assert.equal(r.status, 404);
  r = await api("GET", "/api/documents", { token: ben });
  assert.equal(r.body.documents.length, 0);
  r = await api("GET", `/api/documents/${pdfDocId}`, { token: admin });
  assert.equal(r.status, 403);
  r = await api("GET", `/api/documents/${pdfDocId}`, { token: val });
  assert.equal(r.status, 200);
  r = await api("POST", "/api/documents/upload", { token: val, form: fileForm(PDF, "a.pdf", "application/pdf") });
  assert.equal(r.status, 403);
  r = await api("POST", "/api/documents/upload", { token: ana, form: fileForm("package.json", "x.txt", "text/plain") });
  assert.equal(r.status, 415);
  pass("Isolation: other company gets 404, admin gets 403, viewer is read-only, bad file type rejected");

  // ===================== Knowledge base: global vs private =====================
  r = await api("GET", "/api/knowledge/global", { token: ana });
  const titles = r.body.documents.map((d) => d.title);
  for (const t of ["FinRisk Ratio Interpretation Guide", "SEC Financial Statements Guide", "IFRS Conceptual Framework",
    "IAS 1 Presentation of Financial Statements", "Basel Risk Guidance"]) assert.ok(titles.includes(t), t);

  r = await api("GET", "/api/knowledge/company", { token: ana });
  assert.ok(r.body.documents.some((d) => d.category === "historical_report" && d.automatic));
  r = await api("POST", "/api/knowledge/company", { token: ana, body: {
    title: "Alpha treasury policy", category: "internal_policy",
    content: "The zebracorn liquidity buffer policy requires the treasury team to hold a cash reserve reviewed every quarter." } });
  assert.equal(r.status, 201);
  const privateId = r.body.document.id;

  r = await api("POST", "/api/knowledge/search", { token: ana, body: { query: "zebracorn buffer" } });
  assert.equal(r.body.results[0].document_title, "Alpha treasury policy");
  r = await api("POST", "/api/knowledge/search", { token: ben, body: { query: "zebracorn buffer" } });
  assert.ok(!r.body.results.some((x) => x.document_title === "Alpha treasury policy"));
  r = await api("POST", "/api/knowledge/search", { token: admin, body: { query: "zebracorn buffer" } });
  assert.ok(!r.body.results.some((x) => x.scope === "company"));
  r = await api("GET", "/api/knowledge/company", { token: admin });
  assert.equal(r.status, 403);
  r = await api("GET", `/api/knowledge/company/${privateId}`, { token: ben });
  assert.equal(r.status, 404);
  r = await api("POST", "/api/knowledge/company", { token: val, body: { title: "x", category: "internal_policy", content: "x".repeat(30) } });
  assert.equal(r.status, 403);
  r = await api("POST", "/api/knowledge/global", { token: ana, body: { title: "x", category: "ratio_definitions", content: "x".repeat(30) } });
  assert.equal(r.status, 403);
  r = await api("POST", "/api/knowledge/global", { token: admin, body: {
    title: "Industry note: consumer electronics", category: "industry_information", content: "Consumer electronics companies typically hold low inventory relative to sales." } });
  assert.equal(r.status, 201);
  r = await api("GET", "/api/knowledge/global", { token: ben });
  assert.ok(r.body.documents.some((d) => d.title === "Industry note: consumer electronics"));
  pass("Knowledge: global shared, private visible only to its company, admin has no access to private");

  // ===================== Chat =====================
  r = await api("POST", "/api/chat", { token: ana, body: { question: "What is our zebracorn policy and the current ratio?", document_id: pdfDocId } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.sources, ["ratio:current_ratio"]);
  assert.ok(lastChatPrompt.includes("zebracorn"), "company knowledge should reach the chatbot");
  r = await api("POST", "/api/chat", { token: ben, body: { question: "What is the zebracorn policy?" } });
  assert.ok(!lastChatPrompt.includes("zebracorn liquidity buffer"), "other company's knowledge must not leak");
  r = await api("POST", "/api/chat", { token: ben, body: { question: "x", document_id: pdfDocId } });
  assert.equal(r.status, 404);
  pass("Ask FinRisk: uses own company knowledge, never another company's");

  // ===================== Subscription controls =====================
  r = await api("PATCH", `/api/admin/companies/${alphaId}`, { token: admin, body: { subscription: { chat_enabled: false, max_documents_per_month: 4 } } });
  assert.equal(r.status, 200);
  r = await api("POST", "/api/chat", { token: ana, body: { question: "hi" } });
  assert.equal(r.status, 403);
  r = await api("POST", "/api/documents/upload", { token: ana, form: fileForm(PDF, "a.pdf", "application/pdf") });
  assert.equal(r.status, 403);
  assert.match(r.body.message, /4 documents per month/);
  r = await api("PATCH", `/api/admin/companies/${alphaId}`, { token: admin, body: { is_active: false } });
  r = await api("GET", "/api/documents", { token: ana });
  assert.equal(r.status, 403);
  r = await api("POST", "/api/auth/login", { body: { email: "ana@alpha.test", password: "AnaPass#2026" } });
  assert.equal(r.status, 403);
  r = await api("PATCH", `/api/admin/companies/${alphaId}`, { token: admin, body: { is_active: true, subscription: { chat_enabled: true, max_documents_per_month: 50 } } });
  r = await api("GET", "/api/admin/companies", { token: admin });
  const alpha = r.body.companies.find((c) => c.name === "Alpha Ltd");
  assert.equal(alpha.documents, 4);
  assert.ok(!("documents_list" in alpha));
  pass("Companies: chat and monthly limits enforced, deactivation blocks access, admin sees counts only");

  // ===================== Reset access / deactivate / role =====================
  r = await api("POST", `/api/admin/users/${anaId}/reset-access`, { token: admin });
  const temp = r.body.temporary_password;
  r = await api("GET", "/api/documents", { token: ana });
  assert.equal(r.status, 401); // old session ended
  const ana2 = await loginAndSetPassword("ana@alpha.test", temp, "AnaPass#2027");
  r = await api("PATCH", `/api/admin/users/${anaId}`, { token: admin, body: { role: "viewer" } });
  assert.equal(r.body.user.role, "viewer");
  r = await api("GET", "/api/documents", { token: ana2 });
  assert.equal(r.status, 401);
  r = await api("PATCH", `/api/admin/users/${anaId}`, { token: admin, body: { is_active: false } });
  r = await api("POST", "/api/auth/login", { body: { email: "ana@alpha.test", password: "AnaPass#2027" } });
  assert.equal(r.status, 403);
  r = await api("PATCH", `/api/admin/users/${firstAdmin.user.id}`, { token: admin, body: { is_active: false } });
  assert.equal(r.status, 400);
  pass("Users: reset access signs out + forces new password, role change and deactivation take effect");

  // ===================== System configuration =====================
  r = await api("PUT", "/api/admin/system/config/llm", { token: admin, body: { max_output_tokens: 5 } });
  assert.equal(r.status, 400);
  r = await api("PUT", "/api/admin/system/config/llm", { token: admin, body: { api_key: "x" } });
  assert.equal(r.status, 400);
  r = await api("POST", "/api/admin/system/llm/test", { token: admin });
  assert.equal(r.body.ok, true);
  r = await api("PUT", "/api/admin/system/config/llm", { token: admin, body: { provider: "none" } });
  assert.equal(r.body.llm_status.configured, false);
  const callsBefore = llmCalls;
  r = await api("POST", "/api/documents/upload", { token: ben, form: fileForm(PDF, "Apple.pdf", "application/pdf") });
  doc = await waitForStatus(ben, r.body.document.id);
  assert.equal(doc.status, "completed");
  assert.equal(doc.risk_assessment.generated_by.method, "rule_based");
  assert.equal(llmCalls, callsBefore);
  r = await api("PUT", "/api/admin/system/config/processing", { token: admin, body: { auto_analyze: false, allowed_types: ["pdf"] } });
  r = await api("POST", "/api/documents/upload", { token: ben, form: fileForm(csvFile, "a.csv", "text/csv") });
  assert.equal(r.status, 415);
  r = await api("POST", "/api/documents/upload", { token: ben, form: fileForm(PDF, "Apple.pdf", "application/pdf") });
  assert.equal(r.body.document.status, "validated"); // not auto-analysed
  r = await api("PUT", "/api/admin/system/config/rag", { token: admin, body: { chat_top_k: 2 } });
  assert.equal(r.body.config.chat_top_k, 2);
  assert.deepEqual(r.body.overridden.rag, ["chat_top_k"]);
  r = await api("DELETE", "/api/admin/system/config/llm", { token: admin });
  assert.equal(r.body.config.provider, "gemini"); // back to .env
  assert.deepEqual(r.body.overridden.llm, []);
  r = await api("GET", "/api/admin/system/monitoring", { token: admin });
  const m = r.body.monitoring;
  assert.equal(m.server.database, "connected");
  assert.ok(m.counts.completed_documents >= 5);
  assert.ok(m.llm_last_24h.calls > 0 && m.llm_last_24h.success_rate > 0);
  assert.ok(!JSON.stringify(r.body).includes("test-key"));
  pass("System: LLM / processing / RAG settings validated and applied live, monitoring works, no secrets exposed");

  console.log("\nAll API tests passed.");
} finally {
  server.close();
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
  fs.rmSync(process.env.FINRISK_REPORTS_DIR, { recursive: true, force: true });
  fs.rmSync(process.env.FINRISK_UPLOADS_DIR, { recursive: true, force: true, maxRetries: 2 });
}
