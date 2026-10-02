// ============================================================
// CHAT CONTROLLER  (Risk Advisor Chatbot)
// ------------------------------------------------------------
// POST /api/chat
// body: { "question": "...", "report_id": "...(optional)", "history": [ {role, content} ] }
// ============================================================

import { getReport, isValidReportId } from "../services/reportStore.service.js";
import { answerQuestion } from "../services/riskChatbot.service.js";

export async function chat(req, res) {
  const { question, report_id: reportId, history } = req.body ?? {};

  if (typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ success: false, message: "Question is required" });
  }

  let report = null;
  if (reportId) {
    report = isValidReportId(reportId) ? getReport(reportId) : null;
    if (!report) return res.status(404).json({ success: false, message: "Report not found" });
  }

  try {
    const result = await answerQuestion({ question, history, report });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("[Chatbot] failed:", error);
    return res.status(502).json({ success: false, message: "Chatbot failed", error: error.message });
  }
}
