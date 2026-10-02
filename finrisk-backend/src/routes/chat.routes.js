// ============================================================
// ASK FINRISK (Risk Advisor Chatbot)
//   POST /api/chat  { question, document_id?, history? }
// Uses the selected document's results + global knowledge +
// the user's own company knowledge.
// ============================================================

import express from "express";
import mongoose from "mongoose";
import FinancialDocument from "../models/FinancialDocument.js";
import { requireAuth, requireCompany, asyncHandler } from "../middleware/auth.js";
import { answerQuestion } from "../services/riskChatbot.service.js";

const router = express.Router();
router.use(requireAuth, requireCompany);

router.post("/", asyncHandler(async (req, res) => {
  if (!req.user.company.subscription.chat_enabled) {
    return res.status(403).json({ success: false, message: "Ask FinRisk is not included in your company's plan." });
  }

  const { question, document_id: documentId, history } = req.body ?? {};
  if (typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ success: false, message: "Question is required" });
  }

  let doc = null;
  if (documentId) {
    if (mongoose.isValidObjectId(documentId)) {
      doc = await FinancialDocument.findOne({ _id: documentId, company: req.companyId }).lean();
    }
    if (!doc) return res.status(404).json({ success: false, message: "Document not found" });
  }

  const result = await answerQuestion({ question, history, report: doc, companyId: req.companyId });
  res.json({ success: true, ...result });
}));

export default router;
