// ============================================================
// ANALYSIS PIPELINE
// ------------------------------------------------------------
// Runs everything after extraction, in the order of the
// sequence diagram:
//   Financial Analysis Agent  (LLM selects analyses)
//   Calculation Engine        (deterministic ratios)
//   Risk Advisor Agent        (RAG knowledge + LLM)
//   Report Generator          (PDF)
// Each failure is tagged with the stage it happened in.
// ============================================================

import { validateFinancialData } from "./validation.service.js";
import { runAnalysisAgent, executeAnalysisPlan } from "./analysisAgent.service.js";
import { runRiskAdvisor } from "./riskAdvisor.service.js";
import { generateReportPdf } from "./reportGenerator.service.js";
import { updateReport, pdfPath } from "./reportStore.service.js";

export class PipelineError extends Error {
  constructor(stage, message, cause, status = 500) {
    super(message);
    this.stage = stage;
    this.status = status;
    this.detail = cause?.message ?? null;
  }
}

/**
 * Applies user corrections to extracted values.
 * Only keys that the Document Agent produced can be changed.
 * Returns the new data and a list of what changed.
 */
export function applyCorrections(extracted, corrections) {
  if (!corrections || typeof corrections !== "object") {
    return { data: extracted, corrected_fields: [] };
  }

  const data = { ...extracted };
  const corrected_fields = [];

  for (const [key, raw] of Object.entries(corrections)) {
    if (!Object.hasOwn(extracted, key)) continue; // unknown keys ignored

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

export async function runAnalysisPipeline(report, corrections) {
  // ---------- corrections + validation ----------
  const { data: financialData, corrected_fields } =
    applyCorrections(report.extracted_data ?? report.financial_data, corrections);

  const validation = validateFinancialData(financialData);
  if (!validation.is_valid) {
    updateReport(report.id, { financial_data: financialData, corrected_fields, validation });
    throw new PipelineError("validation", "Required financial values are missing", null, 422);
  }

  // ---------- Analysis Agent ----------
  let analysisPlan;
  try {
    analysisPlan = await runAnalysisAgent(financialData);
  } catch (error) {
    throw new PipelineError("analysis_agent", "Analysis Agent failed", error, 502);
  }

  // ---------- Calculation Engine ----------
  let analysis;
  try {
    analysis = executeAnalysisPlan(financialData, analysisPlan);
  } catch (error) {
    throw new PipelineError("calculation_engine", "Calculation Engine failed", error);
  }
  console.log(
    `[Calculation Engine] ${Object.keys(analysis.calculated_ratios).length} ratios, ` +
    `${analysis.unavailable_calculations.length} unavailable`
  );

  // ---------- Risk Advisor ----------
  let riskAssessment;
  try {
    riskAssessment = await runRiskAdvisor(analysis);
  } catch (error) {
    throw new PipelineError("risk_advisor", "Risk Advisor failed", error, 502);
  }
  console.log(
    `[Risk Advisor] overall ${riskAssessment.overall_assessment.level}, ` +
    `${riskAssessment.risk_factors.length} risk factors (${riskAssessment.generated_by.method})`
  );

  let updated = updateReport(report.id, {
    status: "analyzed",
    financial_data: financialData,
    corrected_fields,
    validation,
    analysis_plan: analysisPlan,
    analysis,
    risk_assessment: riskAssessment
  });

  // ---------- Report Generator ----------
  try {
    await generateReportPdf(updated, pdfPath(report.id));
    updated = updateReport(report.id, { status: "completed", pdf_generated: true });
    console.log(`[Report Generator] PDF saved for ${report.id}`);
  } catch (error) {
    // The analysis is still valid; only the PDF failed.
    console.error("[Report Generator] failed:", error);
    updated = updateReport(report.id, { pdf_generated: false, pdf_error: error.message });
  }

  return updated;
}
