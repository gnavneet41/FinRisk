// ============================================================
// KNOWLEDGE BASE ROUTES
// ------------------------------------------------------------
// GLOBAL  (read: every signed-in user; write: admin only)
//   GET    /api/knowledge/global
//   GET    /api/knowledge/global/:id
//   POST   /api/knowledge/global          admin  (JSON or file upload)
//   PATCH  /api/knowledge/global/:id      admin
//   DELETE /api/knowledge/global/:id      admin
//
// COMPANY (private: only users of that company; admin has NO access)
//   GET    /api/knowledge/company
//   GET    /api/knowledge/company/:id
//   POST   /api/knowledge/company         analyst
//   PATCH  /api/knowledge/company/:id     analyst
//   DELETE /api/knowledge/company/:id     analyst
//
//   POST   /api/knowledge/search          { query }  test retrieval
//          admin -> global only; company user -> global + own company
// ============================================================

import fs from "fs";
import path from "path";
import express from "express";
import multer from "multer";
import mongoose from "mongoose";
import mammoth from "mammoth";
import KnowledgeDocument, { GLOBAL_CATEGORIES, COMPANY_CATEGORIES } from "../models/KnowledgeDocument.js";
import { requireAuth, requireRole, requireCompany, asyncHandler } from "../middleware/auth.js";
import {
  createKnowledgeDocument,
  buildChunks,
  invalidateKnowledgeCache,
  searchKnowledge
} from "../services/knowledgeBase.service.js";
import { extractPdfText } from "../services/document.service.js";
import { logEvent } from "../services/monitoring.service.js";

const router = express.Router();
router.use(requireAuth);

const MAX_KNOWLEDGE_FILE_MB = 10;
const upload = multer({
  dest: path.join(process.env.FINRISK_UPLOADS_DIR || "uploads", "knowledge-tmp"),
  limits: { fileSize: MAX_KNOWLEDGE_FILE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(md|txt|pdf|docx)$/i.test(file.originalname)) cb(null, true);
    else cb(Object.assign(new Error("Knowledge files must be .md, .txt, .pdf or .docx"), { status: 415 }));
  }
});

function optionalFile(req, res, next) {
  if (!req.is("multipart/form-data")) return next();
  upload.single("file")(req, res, (error) => {
    if (!error) return next();
    res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : error.status ?? 400).json({
      success: false,
      message: error.code === "LIMIT_FILE_SIZE" ? `File is too large (max ${MAX_KNOWLEDGE_FILE_MB} MB)` : error.message
    });
  });
}

async function readKnowledgeFile(file) {
  try {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".pdf") return await extractPdfText(file.path);
    if (ext === ".docx") return (await mammoth.extractRawText({ path: file.path })).value;
    return fs.readFileSync(file.path, "utf8");
  } finally {
    fs.promises.unlink(file.path).catch(() => {});
  }
}

// ---------- serialisation ----------
function toClient(doc, { withContent = false } = {}) {
  return {
    id: doc._id.toString(),
    scope: doc.scope,
    title: doc.title,
    category: doc.category,
    source: doc.source,
    description: doc.description,
    is_active: doc.is_active,
    chunk_count: doc.chunks?.length ?? 0,
    created_by: doc.created_by?.name ?? null,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
    automatic: Boolean(doc.source_document),
    ...(withContent ? { content: doc.content, chunks: doc.chunks.map((c) => ({ id: c.chunk_id, heading: c.heading, text: c.text })) } : {})
  };
}

// ---------- shared handlers, parameterised by scope ----------
function scopeFilter(req, scope) {
  return scope === "global" ? { scope: "global" } : { scope: "company", company: req.companyId };
}

const list = (scope) => asyncHandler(async (req, res) => {
  const filter = scopeFilter(req, scope);
  if (scope === "global" && req.user.role !== "admin") filter.is_active = true;
  const docs = await KnowledgeDocument.find(filter).select("-content -chunks.text")
    .populate("created_by", "name").sort({ createdAt: -1 }).lean();
  res.json({
    success: true,
    categories: scope === "global" ? GLOBAL_CATEGORIES : COMPANY_CATEGORIES,
    documents: docs.map((d) => toClient(d))
  });
});

const getOne = (scope) => asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: "Not found" });
  const doc = await KnowledgeDocument.findOne({ _id: req.params.id, ...scopeFilter(req, scope) })
    .populate("created_by", "name").lean();
  if (!doc) return res.status(404).json({ success: false, message: "Not found" });
  res.json({ success: true, document: toClient(doc, { withContent: true }) });
});

const create = (scope) => asyncHandler(async (req, res) => {
  const categories = scope === "global" ? GLOBAL_CATEGORIES : COMPANY_CATEGORIES;
  const body = req.body ?? {};
  let content = typeof body.content === "string" ? body.content : "";
  if (req.file) content = await readKnowledgeFile(req.file);

  const title = String(body.title ?? req.file?.originalname ?? "").trim();
  if (!title) return res.status(400).json({ success: false, message: "Title is required" });
  if (!categories.includes(body.category)) {
    return res.status(400).json({ success: false, message: `Category must be one of: ${categories.join(", ")}` });
  }
  if (content.trim().length < 20) {
    return res.status(400).json({ success: false, message: "Add the document text (at least 20 characters) or upload a file" });
  }

  const doc = await createKnowledgeDocument({
    scope,
    company: scope === "company" ? req.companyId : null,
    title: title.slice(0, 160),
    category: body.category,
    source: String(body.source ?? "").slice(0, 300),
    description: String(body.description ?? "").slice(0, 500),
    content,
    created_by: req.user._id
  });
  logEvent(scope === "global" ? "admin" : "knowledge", `Knowledge added (${scope}): ${doc.title}`, {
    user: req.user._id, company: scope === "company" ? req.companyId : null
  });
  res.status(201).json({ success: true, document: toClient(doc) });
});

const update = (scope) => asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: "Not found" });
  const doc = await KnowledgeDocument.findOne({ _id: req.params.id, ...scopeFilter(req, scope) });
  if (!doc) return res.status(404).json({ success: false, message: "Not found" });

  const categories = scope === "global" ? GLOBAL_CATEGORIES : COMPANY_CATEGORIES;
  const b = req.body ?? {};
  if (b.title !== undefined) doc.title = String(b.title).trim().slice(0, 160) || doc.title;
  if (b.category !== undefined) {
    if (!categories.includes(b.category)) return res.status(400).json({ success: false, message: "Invalid category" });
    doc.category = b.category;
  }
  if (b.source !== undefined) doc.source = String(b.source).slice(0, 300);
  if (b.description !== undefined) doc.description = String(b.description).slice(0, 500);
  if (b.is_active !== undefined) doc.is_active = Boolean(b.is_active);
  if (typeof b.content === "string" && b.content.trim().length >= 20 && !doc.chunks.some((c) => c.applies_to?.length)) {
    doc.content = b.content;
    doc.chunks = buildChunks(b.content, scope === "global" ? "G" : "C");
  }
  await doc.save();
  invalidateKnowledgeCache();
  res.json({ success: true, document: toClient(doc) });
});

const remove = (scope) => asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: "Not found" });
  const result = await KnowledgeDocument.deleteOne({ _id: req.params.id, ...scopeFilter(req, scope) });
  if (!result.deletedCount) return res.status(404).json({ success: false, message: "Not found" });
  invalidateKnowledgeCache();
  res.json({ success: true });
});

function requirePrivateKnowledge(req, res, next) {
  if (!req.user.company.subscription.private_knowledge_enabled) {
    return res.status(403).json({ success: false, message: "Company knowledge is not included in your plan." });
  }
  next();
}

// ---------- GLOBAL ----------
router.get("/global", list("global"));
router.get("/global/:id", getOne("global"));
router.post("/global", requireRole("admin"), optionalFile, create("global"));
router.patch("/global/:id", requireRole("admin"), update("global"));
router.delete("/global/:id", requireRole("admin"), remove("global"));

// ---------- COMPANY (requireCompany blocks the admin) ----------
router.get("/company", requireCompany, list("company"));
router.get("/company/:id", requireCompany, getOne("company"));
router.post("/company", requireCompany, requireRole("analyst"), requirePrivateKnowledge, optionalFile, create("company"));
router.patch("/company/:id", requireCompany, requireRole("analyst"), requirePrivateKnowledge, update("company"));
router.delete("/company/:id", requireCompany, requireRole("analyst"), remove("company"));

// ---------- SEARCH ----------
router.post("/search", asyncHandler(async (req, res) => {
  const query = String(req.body?.query ?? "").trim();
  if (!query) return res.status(400).json({ success: false, message: "Query is required" });
  const companyId = req.user.role === "admin" ? null : req.user.company?._id ?? null;
  const results = await searchKnowledge(query, { companyId, limit: 6 });
  res.json({ success: true, results });
}));

export default router;
