// ============================================================
// REPORT STORE
// ------------------------------------------------------------
// Saves each analysis as reports/<id>.json (and the PDF as
// reports/<id>.pdf). Simple file storage so results survive a
// server restart without needing MongoDB yet.
// Phase 6 can replace these functions with Mongoose models.
// ============================================================

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// FINRISK_REPORTS_DIR lets the tests use a temporary folder.
export const REPORTS_DIR =
  process.env.FINRISK_REPORTS_DIR || path.join(__dirname, "..", "..", "reports");

// Ids look like 20261002-153045-a1b2c3 — checked before every file access
// so a request can never read files outside reports/.
const ID_PATTERN = /^\d{8}-\d{6}-[a-f0-9]{6}$/;

function ensureDir() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function newId() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${date}-${time}-${crypto.randomBytes(3).toString("hex")}`;
}

export function isValidReportId(id) {
  return typeof id === "string" && ID_PATTERN.test(id);
}

export function jsonPath(id) {
  return path.join(REPORTS_DIR, `${id}.json`);
}

export function pdfPath(id) {
  return path.join(REPORTS_DIR, `${id}.pdf`);
}

export function createReport(data) {
  ensureDir();
  const id = newId();
  const report = {
    id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: "extracted",
    ...data
  };
  fs.writeFileSync(jsonPath(id), JSON.stringify(report, null, 2));
  return report;
}

export function getReport(id) {
  if (!isValidReportId(id) || !fs.existsSync(jsonPath(id))) return null;
  return JSON.parse(fs.readFileSync(jsonPath(id), "utf8"));
}

export function updateReport(id, patch) {
  const report = getReport(id);
  if (!report) throw new Error(`Report not found: ${id}`);
  const updated = { ...report, ...patch, updated_at: new Date().toISOString() };
  fs.writeFileSync(jsonPath(id), JSON.stringify(updated, null, 2));
  return updated;
}

/** Short summaries, newest first (for the history list). */
export function listReports() {
  ensureDir();
  return fs.readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith(".json") && isValidReportId(f.slice(0, -5)))
    .map((f) => {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, f), "utf8"));
        return {
          id: r.id,
          created_at: r.created_at,
          status: r.status,
          filename: r.document?.filename ?? null,
          company: r.financial_data?.company ?? null,
          fiscal_year: r.financial_data?.fiscal_year ?? null,
          overall_level: r.risk_assessment?.overall_assessment?.level ?? null,
          has_pdf: fs.existsSync(pdfPath(r.id))
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}
