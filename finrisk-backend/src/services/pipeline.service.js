// ============================================================
// DOCUMENT PIPELINE  (MongoDB)
// ------------------------------------------------------------
// Statuses (shown as the stepper in the Upload page):
//   uploaded -> extracted -> validated -> analyzing -> completed
//                                  \-> needs_review (user corrects values)
//   any stage can end in "failed" (with the stage recorded)
//
// Upload, extraction and validation run inside the upload request
// (a few seconds). The analysis (2 LLM calls) runs in the
// background; the frontend polls the document for its status.
// ============================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import FinancialDocument from "../models/FinancialDocument.js";
import { extractFinancialData } from "./document.service.js";
import { validateFinancialData } from "./validation.service.js";
import { runAnalysisAgent, executeAnalysisPlan } from "./analysisAgent.service.js";
import { runRiskAdvisor } from "./riskAdvisor.service.js";
import { generateReportPdf } from "./reportGenerator.service.js";
import { saveHistoricalReport } from "./knowledgeBase.service.js";
import { getConfig } from "./systemConfig.service.js";
import { logEvent } from "./monitoring.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPORTS_DIR =
  process.env.FINRISK_REPORTS_DIR || path.join(__dirname, "..", "..", "reports");

export class PipelineError extends Error {
  constructor(stage, message, detail = null, status = 500) {
    super(message);
    this.stage = stage;
    this.detail = detail;
    this.status = status;
  }
}

const fileTypeOf = (name) => path.extname(name).toLowerCase().replace(".", "");


// ============================================================
// 1. UPLOAD -> EXTRACT -> VALIDATE   (synchronous part)
// ============================================================

export async function processUpload({ file, user }) {
  const doc = new FinancialDocument({
    company: user.company._id,
    uploaded_by: user._id,
    filename: file.originalname,
    mimetype: file.mimetype,
    file_type: fileTypeOf(file.originalname),
    size_bytes: file.size,
    storage_path: file.path
  });
  doc.setStatus("uploaded");
  await doc.save();

  // ---------- Document Agent ----------
  let extracted;
  try {
    extracted = await extractFinancialData(file.path, file.mimetype, file.originalname);
  } catch (error) {
    doc.setStatus("failed", error.message);
    doc.error = { stage: "document_agent", message: "Failed to extract financial data", detail: error.message };
    await doc.save();
    logEvent("pipeline", `Extraction failed: ${doc.filename}`, { level: "error", company: doc.company, user: user._id });
    return doc;
  }

  if (!getConfig("processing").keep_uploaded_files) {
    fs.promises.unlink(file.path).catch(() => {});
  }

  doc.extracted_data = extracted;
  doc.financial_data = extracted;
  doc.company_name = extracted.company ?? null;
  doc.fiscal_year = extracted.fiscal_year ?? null;
  const found = Object.values(extracted).filter((v) => v !== null).length;
  doc.setStatus("extracted", `${found} of ${Object.keys(extracted).length} values found`);

  // ---------- Validation ----------
  doc.validation = validateFinancialData(extracted);
  if (doc.validation.is_valid) {
    doc.setStatus("validated", `${doc.validation.warnings.length} warnings`);
  } else {
    doc.setStatus("needs_review", `${doc.validation.errors.length} required values missing`);
  }
  doc.markModified("extracted_data");
  doc.markModified("financial_data");
  doc.markModified("validation");
  await doc.save();

  logEvent("pipeline", `Uploaded ${doc.filename} (${doc.status})`, { company: doc.company, user: user._id });

  if (doc.status === "validated" && getConfig("processing").auto_analyze) {
    await startAnalysis(doc);
  }
  return doc;
}


// ============================================================
// 2. CORRECTIONS
// ============================================================

/** Applies user corrections; only fields the Document Agent produced can change. */
export function applyCorrections(extracted, corrections) {
  if (!corrections || typeof corrections !== "object") return { data: extracted, corrected_fields: [] };

  const data = { ...extracted };
  const corrected_fields = [];
  for (const [key, raw] of Object.entries(corrections)) {
    if (!Object.hasOwn(extracted, key)) continue;

    let value;
    if (key === "company" || key === "fiscal_year") {
      value = typeof raw === "string" && raw.trim() ? raw.trim() : null;
    } else if (raw === null || raw === "") {
      value = null;
    } else {
      value = Number(String(raw).replace(/,/g, ""));
      if (!Number.isFinite(value)) {
        throw new PipelineError("validation", `Value for ${key} is not a number`, null, 422);
      }
    }
    if (value !== extracted[key]) {
      corrected_fields.push({ key, extracted: extracted[key], corrected: value });
      data[key] = value;
    }
  }
  return { data, corrected_fields };
}


// ============================================================
// 3. START ANALYSIS (validates now, runs in the background)
// ============================================================

export async function startAnalysis(doc, corrections = undefined) {
  if (doc.status === "analyzing") {
    throw new PipelineError("analysis", "This document is already being analysed", null, 409);
  }
  if (!doc.extracted_data) {
    throw new PipelineError("document_agent", "Nothing was extracted from this document", null, 422);
  }

  if (corrections !== undefined) {
    const { data, corrected_fields } = applyCorrections(doc.extracted_data, corrections);
    doc.financial_data = data;
    doc.corrected_fields = corrected_fields;
    doc.company_name = data.company ?? null;
    doc.fiscal_year = data.fiscal_year ?? null;
    doc.validation = validateFinancialData(data);
    doc.markModified("financial_data");
    doc.markModified("validation");
  }

  if (!doc.validation?.is_valid) {
    doc.setStatus("needs_review", "Required values are missing");
    await doc.save();
    throw new PipelineError("validation", "Required financial values are missing", null, 422);
  }

  doc.error = undefined;
  doc.setStatus("analyzing");
  await doc.save();

  // Background job: not awaited, so the request returns immediately.
  setImmediate(() => {
    runAnalysis(doc._id).catch((e) => console.error("[Pipeline] unexpected error:", e));
  });
  return doc;
}


// ============================================================
// 4. ANALYSIS -> RISK ADVISOR -> REPORT   (background)
// ============================================================

export async function runAnalysis(documentId) {
  const doc = await FinancialDocument.findById(documentId);
  if (!doc) return;
  const started = Date.now();
  const fail = async (stage, message, error) => {
    console.error(`[Pipeline] ${stage} failed:`, error?.message ?? error);
    doc.setStatus("failed", message);
    doc.error = { stage, message, detail: error?.message ?? null };
    await doc.save();
    logEvent("pipeline", `${message}: ${doc.filename}`, { level: "error", company: doc.company, meta: { stage } });
  };

  const financialData = doc.financial_data;

  // ---------- Analysis Agent ----------
  let plan;
  try {
    plan = await runAnalysisAgent(financialData);
  } catch (e) {
    return fail("analysis_agent", "Analysis Agent failed", e);
  }

  // ---------- Calculation Engine ----------
  let analysis;
  try {
    analysis = executeAnalysisPlan(financialData, plan);
  } catch (e) {
    return fail("calculation_engine", "Calculation Engine failed", e);
  }

  // ---------- Risk Advisor (global + this company's knowledge) ----------
  let risk;
  try {
    risk = await runRiskAdvisor(analysis, { companyId: doc.company });
  } catch (e) {
    return fail("risk_advisor", "Risk Advisor failed", e);
  }

  doc.analysis_plan = plan;
  doc.analysis = analysis;
  doc.risk_assessment = risk;
  doc.overall_risk_level = risk.overall_assessment.level;
  doc.analyzed_at = new Date();
  doc.markModified("analysis_plan");
  doc.markModified("analysis");
  doc.markModified("risk_assessment");

  // ---------- Report Generator ----------
  try {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const pdfFile = path.join(REPORTS_DIR, `${doc._id}.pdf`);
    await generateReportPdf(toReportInput(doc), pdfFile);
    doc.pdf_path = pdfFile;
    doc.pdf_generated = true;
  } catch (e) {
    console.error("[Report Generator] failed:", e);
    doc.pdf_generated = false;
  }

  doc.setStatus("completed", `${risk.overall_assessment.level} risk`);
  await doc.save();

  // ---------- Historical report -> company knowledge ----------
  try {
    await saveHistoricalReport(doc);
  } catch (e) {
    console.warn("[Knowledge Base] could not save historical report:", e.message);
  }

  const methods = `${plan.generated_by.method}/${risk.generated_by.method}`;
  logEvent("pipeline", `Analysis completed: ${doc.filename}`, {
    company: doc.company,
    meta: { duration_ms: Date.now() - started, methods, overall: risk.overall_assessment.level }
  });
  console.log(`[Pipeline] ${doc.filename} completed in ${Date.now() - started} ms (${methods})`);
}

/** Shape expected by the report generator. */
export function toReportInput(doc) {
  return {
    id: doc._id.toString(),
    document: { filename: doc.filename },
    financial_data: doc.financial_data,
    analysis_plan: doc.analysis_plan,
    analysis: doc.analysis,
    risk_assessment: doc.risk_assessment
  };
}

/** Mark analyses interrupted by a server restart as failed. */
export async function recoverInterruptedAnalyses() {
  const stuck = await FinancialDocument.find({ status: "analyzing" });
  for (const doc of stuck) {
    doc.setStatus("failed", "Interrupted by a server restart");
    doc.error = { stage: "analysis", message: "Interrupted by a server restart. Run the analysis again." };
    await doc.save();
  }
  return stuck.length;
}
