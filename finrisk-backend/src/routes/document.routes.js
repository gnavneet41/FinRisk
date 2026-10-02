// ============================================================
// DOCUMENT ROUTES  (company users only)
//   GET    /api/documents                 list (?status=completed)
//   GET    /api/documents/stats           counts for the dashboard
//   GET    /api/documents/templates/:type sample CSV / Excel file
//   POST   /api/documents/upload          analyst  (field "document")
//   GET    /api/documents/:id
//   POST   /api/documents/:id/analyze     analyst  { financial_data: corrections }
//   GET    /api/documents/:id/pdf
//   DELETE /api/documents/:id             analyst
// Every query is filtered by the user's company.
// ============================================================

import fs from "fs";
import path from "path";
import express from "express";
import multer from "multer";
import mongoose from "mongoose";
import FinancialDocument from "../models/FinancialDocument.js";
import KnowledgeDocument from "../models/KnowledgeDocument.js";
import { requireAuth, requireCompany, requireRole, asyncHandler } from "../middleware/auth.js";
import { processUpload, startAnalysis, PipelineError, toReportInput, REPORTS_DIR } from "../services/pipeline.service.js";
import { generateReportPdf } from "../services/reportGenerator.service.js";
import { getConfig } from "../services/systemConfig.service.js";
import { invalidateKnowledgeCache } from "../services/knowledgeBase.service.js";
import { sampleCsv, sampleXlsx } from "../services/tabularExtraction.service.js";

const router = express.Router();
router.use(requireAuth, requireCompany);

const HARD_SIZE_LIMIT_MB = 100;
// FINRISK_UPLOADS_DIR lets the tests use a temporary folder.
const UPLOADS_DIR = process.env.FINRISK_UPLOADS_DIR || "uploads";
const MIME_BY_TYPE = {
  pdf: ["application/pdf"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  csv: ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOADS_DIR, String(req.companyId));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
    }
  }),
  limits: { fileSize: HARD_SIZE_LIMIT_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const type = path.extname(file.originalname).toLowerCase().replace(".", "");
    const allowed = getConfig("processing").allowed_types;
    if (allowed.includes(type) && MIME_BY_TYPE[type]?.includes(file.mimetype)) cb(null, true);
    else cb(Object.assign(new Error(`Unsupported document format. Allowed: ${allowed.join(", ")}`), { status: 415 }));
  }
});

function handleUpload(req, res, next) {
  upload.single("document")(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error.code === "LIMIT_FILE_SIZE";
    return res.status(tooLarge ? 413 : error.status ?? 400).json({
      success: false,
      stage: "upload",
      message: tooLarge ? "File is too large" : error.message
    });
  });
}

// ---------- serialisation ----------
const LIST_FIELDS = "filename file_type size_bytes status company_name fiscal_year overall_risk_level pdf_generated analyzed_at createdAt updatedAt uploaded_by error";

export function toClientDocument(doc) {
  const d = doc.toObject ? doc.toObject() : doc;
  return {
    id: d._id.toString(),
    filename: d.filename,
    file_type: d.file_type,
    size_bytes: d.size_bytes,
    status: d.status,
    status_history: d.status_history,
    error: d.error?.stage ? d.error : null,
    company_name: d.company_name,
    fiscal_year: d.fiscal_year,
    overall_risk_level: d.overall_risk_level,
    uploaded_by: d.uploaded_by?.name ? { name: d.uploaded_by.name, email: d.uploaded_by.email } : null,
    created_at: d.createdAt,
    analyzed_at: d.analyzed_at,
    pdf_url: d.pdf_generated ? `/api/documents/${d._id}/pdf` : null,
    extracted_data: d.extracted_data,
    financial_data: d.financial_data,
    corrected_fields: d.corrected_fields,
    validation: d.validation,
    analysis_plan: d.analysis_plan,
    analysis: d.analysis,
    risk_assessment: d.risk_assessment
  };
}

async function findOwnDocument(req, res, select = "") {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ success: false, message: "Document not found" });
    return null;
  }
  const doc = await FinancialDocument.findOne({ _id: req.params.id, company: req.companyId })
    .select(select).populate("uploaded_by", "name email");
  if (!doc) res.status(404).json({ success: false, message: "Document not found" });
  return doc;
}

// ---------- routes ----------
router.get("/", asyncHandler(async (req, res) => {
  const filter = { company: req.companyId };
  if (req.query.status) filter.status = String(req.query.status);
  const docs = await FinancialDocument.find(filter).select(LIST_FIELDS)
    .populate("uploaded_by", "name email").sort({ createdAt: -1 }).limit(200).lean();
  res.json({ success: true, documents: docs.map(toClientDocument) });
}));

router.get("/stats", asyncHandler(async (req, res) => {
  const docs = await FinancialDocument.find({ company: req.companyId }).select("status createdAt").lean();
  const byStatus = {};
  for (const d of docs) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
  const latest = await FinancialDocument.findOne({ company: req.companyId, status: "completed" })
    .sort({ analyzed_at: -1 }).select("_id").lean();
  res.json({
    success: true,
    stats: {
      total: docs.length,
      by_status: byStatus,
      this_month: docs.filter((d) => d.createdAt >= startOfMonth()).length,
      monthly_limit: req.user.company.subscription.max_documents_per_month,
      latest_completed_id: latest?._id?.toString() ?? null
    }
  });
}));

router.get("/templates/:type", asyncHandler(async (req, res) => {
  if (req.params.type === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="finrisk_template_apple_fy2024.csv"');
    return res.send(sampleCsv());
  }
  if (req.params.type === "xlsx") {
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="finrisk_template_apple_fy2024.xlsx"');
    return res.send(Buffer.from(await sampleXlsx()));
  }
  res.status(404).json({ success: false, message: "Template not found" });
}));

router.post("/upload", requireRole("analyst"), checkMonthlyLimit, handleUpload, asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, stage: "upload", message: "No document uploaded" });
  }
  const maxMb = getConfig("processing").max_file_size_mb;
  if (req.file.size > maxMb * 1024 * 1024) {
    fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(413).json({ success: false, stage: "upload", message: `File is too large (max ${maxMb} MB)` });
  }

  const doc = await processUpload({ file: req.file, user: req.user });
  res.status(201).json({ success: true, document: toClientDocument(doc) });
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const doc = await findOwnDocument(req, res);
  if (doc) res.json({ success: true, document: toClientDocument(doc) });
}));

router.post("/:id/analyze", requireRole("analyst"), asyncHandler(async (req, res) => {
  const doc = await findOwnDocument(req, res);
  if (!doc) return;
  try {
    await startAnalysis(doc, req.body?.financial_data);
    res.status(202).json({ success: true, document: toClientDocument(doc) });
  } catch (error) {
    if (!(error instanceof PipelineError)) throw error;
    res.status(error.status).json({
      success: false, stage: error.stage, message: error.message, document: toClientDocument(doc)
    });
  }
}));

router.get("/:id/pdf", asyncHandler(async (req, res) => {
  const doc = await findOwnDocument(req, res, "+pdf_path");
  if (!doc) return;
  if (!doc.risk_assessment) {
    return res.status(409).json({ success: false, message: "This document has not been analysed yet" });
  }
  let file = doc.pdf_path;
  if (!file || !fs.existsSync(file)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    file = path.join(REPORTS_DIR, `${doc._id}.pdf`);
    await generateReportPdf(toReportInput(doc), file);
    doc.pdf_path = file;
    doc.pdf_generated = true;
    await doc.save();
  }
  const name = `FinRisk_${(doc.company_name ?? "Report").replace(/[^a-zA-Z0-9]+/g, "_")}_${doc.fiscal_year ?? ""}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${req.query.inline ? "inline" : "attachment"}; filename="${name}"`);
  fs.createReadStream(file).pipe(res);
}));

router.delete("/:id", requireRole("analyst"), asyncHandler(async (req, res) => {
  const doc = await findOwnDocument(req, res, "+storage_path +pdf_path");
  if (!doc) return;
  if (doc.status === "analyzing") {
    return res.status(409).json({ success: false, message: "Wait for the analysis to finish before deleting" });
  }
  for (const f of [doc.storage_path, doc.pdf_path]) if (f) fs.promises.unlink(f).catch(() => {});
  await KnowledgeDocument.deleteMany({ scope: "company", source_document: doc._id });
  invalidateKnowledgeCache();
  await doc.deleteOne();
  res.json({ success: true });
}));

// ---------- helpers ----------
function startOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

async function checkMonthlyLimit(req, res, next) {
  try {
    const limit = req.user.company.subscription.max_documents_per_month;
    const used = await FinancialDocument.countDocuments({ company: req.companyId, createdAt: { $gte: startOfMonth() } });
    if (used >= limit) {
      return res.status(403).json({
        success: false,
        message: `Your plan allows ${limit} documents per month and this month's limit is reached.`
      });
    }
    next();
  } catch (e) {
    next(e);
  }
}

export default router;
