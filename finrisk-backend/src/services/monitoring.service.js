// ============================================================
// MONITORING
// ------------------------------------------------------------
// Records events (metadata only, never document contents) and
// summarises them for the admin's System Monitoring page.
// ============================================================

import os from "os";
import mongoose from "mongoose";
import ActivityLog from "../models/ActivityLog.js";
import User from "../models/User.js";
import Company from "../models/Company.js";
import FinancialDocument from "../models/FinancialDocument.js";
import KnowledgeDocument from "../models/KnowledgeDocument.js";
import { databaseStatus } from "../config/db.js";

const startedAt = new Date();

/** Fire-and-forget: monitoring must never break a request. */
export function logEvent(type, message, { level = "info", company = null, user = null, meta = {} } = {}) {
  if (mongoose.connection.readyState !== 1) return;
  ActivityLog.create({ type, level, message, company, user, meta }).catch((e) =>
    console.warn("[Monitoring] could not log event:", e.message)
  );
}

export async function getMonitoringStats() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    users, activeUsers, companies, activeCompanies,
    documents, completed, failed, processing,
    globalKnowledge, companyKnowledge,
    llmCalls, recentEvents, recentErrors
  ] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ is_active: true }),
    Company.countDocuments({}),
    Company.countDocuments({ is_active: true }),
    FinancialDocument.countDocuments({}),
    FinancialDocument.countDocuments({ status: "completed" }),
    FinancialDocument.countDocuments({ status: "failed" }),
    FinancialDocument.countDocuments({ status: { $in: ["uploaded", "extracted", "validated", "analyzing"] } }),
    KnowledgeDocument.countDocuments({ scope: "global" }),
    KnowledgeDocument.countDocuments({ scope: "company" }),
    ActivityLog.find({ type: "llm_call", createdAt: { $gte: since } }).select("meta level createdAt").lean(),
    ActivityLog.find({}).sort({ createdAt: -1 }).limit(25)
      .populate("company", "name").populate("user", "email").lean(),
    ActivityLog.find({ level: "error" }).sort({ createdAt: -1 }).limit(10)
      .populate("company", "name").lean()
  ]);

  const ok = llmCalls.filter((c) => c.meta?.outcome === "success");
  const latencies = ok.map((c) => c.meta?.latency_ms).filter((n) => typeof n === "number");
  const byAgent = {};
  for (const c of llmCalls) {
    const agent = c.meta?.agent ?? "unknown";
    byAgent[agent] ??= { success: 0, failed: 0 };
    byAgent[agent][c.meta?.outcome === "success" ? "success" : "failed"]++;
  }

  return {
    server: {
      started_at: startedAt,
      uptime_seconds: Math.round(process.uptime()),
      node_version: process.version,
      memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      load_average: os.loadavg().map((n) => Number(n.toFixed(2))),
      database: databaseStatus()
    },
    counts: {
      users, active_users: activeUsers,
      companies, active_companies: activeCompanies,
      documents, completed_documents: completed, failed_documents: failed, processing_documents: processing,
      global_knowledge: globalKnowledge, company_knowledge: companyKnowledge
    },
    llm_last_24h: {
      calls: llmCalls.length,
      successful: ok.length,
      failed: llmCalls.length - ok.length,
      success_rate: llmCalls.length ? Number((ok.length / llmCalls.length).toFixed(3)) : null,
      avg_latency_ms: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
      by_agent: byAgent
    },
    recent_events: recentEvents.map(formatEvent),
    recent_errors: recentErrors.map(formatEvent)
  };
}

function formatEvent(e) {
  return {
    id: e._id.toString(),
    type: e.type,
    level: e.level,
    message: e.message,
    company: e.company?.name ?? null,
    user: e.user?.email ?? null,
    meta: e.meta,
    at: e.createdAt
  };
}
