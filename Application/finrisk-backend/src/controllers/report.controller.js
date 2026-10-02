// ============================================================
// REPORT CONTROLLER
// ------------------------------------------------------------
// POST /api/reports/:id/analyze   run Analysis -> Risk Advisor -> PDF
//                                 body (optional): { "financial_data": { key: corrected value } }
// GET  /api/reports               list saved reports
// GET  /api/reports/:id           one report (JSON)
// GET  /api/reports/:id/pdf       download the PDF report
// ============================================================

import fs from "fs";
import {
  getReport,
  listReports,
  pdfPath,
  isValidReportId
} from "../services/reportStore.service.js";
import { runAnalysisPipeline, PipelineError } from "../services/pipeline.service.js";
import { generateReportPdf } from "../services/reportGenerator.service.js";

/** What the frontend receives (adds the PDF link). */
export function toClientReport(report) {
  return {
    ...report,
    pdf_url: report.pdf_generated ? `/api/reports/${report.id}/pdf` : null
  };
}

export function sendPipelineError(res, error, reportId) {
  const isPipeline = error instanceof PipelineError;
  if (!isPipeline) console.error("[Pipeline] unexpected error:", error);

  const latest = reportId ? getReport(reportId) : null;
  return res.status(isPipeline ? error.status : 500).json({
    success: false,
    stage: isPipeline ? error.stage : "server",
    message: error.message,
    error: isPipeline ? error.detail : error.message,
    report: latest ? toClientReport(latest) : null
  });
}

function findReportOr404(req, res) {
  const report = isValidReportId(req.params.id) ? getReport(req.params.id) : null;
  if (!report) {
    res.status(404).json({ success: false, message: "Report not found" });
    return null;
  }
  return report;
}

export async function analyzeReport(req, res) {
  const report = findReportOr404(req, res);
  if (!report) return;

  try {
    const analyzed = await runAnalysisPipeline(report, req.body?.financial_data);
    return res.json({ success: true, report: toClientReport(analyzed) });
  } catch (error) {
    return sendPipelineError(res, error, report.id);
  }
}

export function listAllReports(req, res) {
  res.json({ success: true, reports: listReports() });
}

export function getOneReport(req, res) {
  const report = findReportOr404(req, res);
  if (!report) return;
  res.json({ success: true, report: toClientReport(report) });
}

export async function downloadPdf(req, res) {
  const report = findReportOr404(req, res);
  if (!report) return;

  if (!report.risk_assessment) {
    return res.status(409).json({ success: false, message: "Report has not been analyzed yet" });
  }

  const file = pdfPath(report.id);
  try {
    // Re-create the PDF if it was deleted or failed earlier.
    if (!fs.existsSync(file)) await generateReportPdf(report, file);
  } catch (error) {
    return res.status(500).json({ success: false, message: "Report Generator failed", error: error.message });
  }

  const company = (report.financial_data?.company ?? "company").replace(/[^a-zA-Z0-9]+/g, "_");
  const year = report.financial_data?.fiscal_year ?? "";
  res.download(file, `FinRisk_Report_${company}_${year}.pdf`);
}
