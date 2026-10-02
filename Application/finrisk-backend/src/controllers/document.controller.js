// ============================================================
// DOCUMENT CONTROLLER  (Document Processing Agent)
// ------------------------------------------------------------
// POST /api/documents/upload
//   1. Document Agent  -> extractFinancialData()
//   2. Validation      -> validateFinancialData()
//   3. Save as a new report (status "extracted")
//   -> returns the processed data to the frontend for review.
//
// POST /api/documents/upload?analyze=true
//   also runs the full analysis pipeline in the same request
//   (handy for curl testing).
// ============================================================

import { extractFinancialData } from "../services/document.service.js";
import { validateFinancialData } from "../services/validation.service.js";
import { createReport } from "../services/reportStore.service.js";
import { runAnalysisPipeline } from "../services/pipeline.service.js";
import { toClientReport, sendPipelineError } from "./report.controller.js";

export async function uploadDocument(req, res) {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      stage: "upload",
      message: "No document uploaded"
    });
  }

  const document = {
    filename: req.file.originalname,
    mimetype: req.file.mimetype,
    size_bytes: req.file.size
  };
  console.log(`[Upload] ${document.filename} (${document.mimetype})`);

  // ---------------- Document Agent ----------------
  let financialData;
  try {
    financialData = await extractFinancialData(
      req.file.path,
      req.file.mimetype,
      req.file.originalname
    );
  } catch (error) {
    console.error("[Document Agent] failed:", error);
    const unsupported = error.message.startsWith("Unsupported document format");
    return res.status(unsupported ? 415 : 500).json({
      success: false,
      stage: "document_agent",
      message: unsupported ? "Unsupported document format" : "Failed to extract financial data",
      error: error.message
    });
  }

  // ---------------- Validation ----------------
  const validation = validateFinancialData(financialData);

  const extractedCount = Object.entries(financialData)
    .filter(([k, v]) => !["company", "fiscal_year"].includes(k) && v !== null).length;
  console.log(`[Document Agent] ${extractedCount} values extracted, valid: ${validation.is_valid}`);

  const report = createReport({
    document,
    extracted_data: financialData, // original extraction, never overwritten
    financial_data: financialData, // may later include user corrections
    validation
  });

  // ---------------- Optional: full pipeline ----------------
  if (req.query.analyze === "true") {
    try {
      const analyzed = await runAnalysisPipeline(report);
      return res.json({ success: true, report: toClientReport(analyzed) });
    } catch (error) {
      return sendPipelineError(res, error, report.id);
    }
  }

  return res.json({ success: true, report: toClientReport(report) });
}
