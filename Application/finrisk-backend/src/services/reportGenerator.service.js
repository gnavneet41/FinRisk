// ============================================================
// REPORT GENERATOR
// ------------------------------------------------------------
// Builds the Financial Risk Report PDF from the stored analysis
// and risk assessment. No LLM call: the report only lays out
// results that were already produced and validated.
// ============================================================

import fs from "fs";
import PDFDocument from "pdfkit";

const COLORS = {
  ink: "#1b2430",
  muted: "#5b6675",
  rule: "#d5dbe3",
  accent: "#1f4e79",
  low: "#2e7d4f",
  moderate: "#b7791f",
  elevated: "#c05621",
  high: "#b42318"
};

const CATEGORY_LABELS = {
  liquidity_analysis: "Liquidity",
  solvency_analysis: "Solvency",
  profitability_analysis: "Profitability",
  efficiency_analysis: "Efficiency",
  cash_flow_analysis: "Cash flow"
};

const label = (key) =>
  String(key).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function formatValue(value, unit) {
  if (typeof value !== "number") return String(value ?? "-");
  if (unit === "percent") return `${value.toFixed(2)}%`;
  if (unit === "times") return `${value.toFixed(2)}x`;
  if (unit === "ratio") return value.toFixed(4);
  return value.toLocaleString("en-US");
}

/**
 * Writes the PDF to outputPath. Resolves when the file is complete.
 */
export function generateReportPdf(report, outputPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
    const stream = fs.createWriteStream(outputPath);
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.on("error", reject);
    doc.pipe(stream);

    const { analysis, risk_assessment: risk, financial_data: data } = report;
    const width = doc.page.width - 100;

    // ---------- helpers ----------
    const heading = (text) => {
      ensureSpace(60);
      doc.moveDown(0.8);
      doc.font("Helvetica-Bold").fontSize(13).fillColor(COLORS.accent).text(text);
      const y = doc.y + 2;
      doc.moveTo(50, y).lineTo(50 + width, y).lineWidth(0.7).strokeColor(COLORS.rule).stroke();
      doc.moveDown(0.5);
      doc.font("Helvetica").fontSize(10).fillColor(COLORS.ink);
    };
    const body = (text, opts = {}) =>
      doc.font("Helvetica").fontSize(10).fillColor(COLORS.ink).text(text, { width, ...opts });
    const small = (text) =>
      doc.font("Helvetica").fontSize(8.5).fillColor(COLORS.muted).text(text, { width });
    const bullet = (text) => {
      ensureSpace(30);
      doc.font("Helvetica").fontSize(10).fillColor(COLORS.ink)
        .text(`-  ${text}`, { width: width - 10, indent: 0 });
      doc.moveDown(0.2);
    };
    function ensureSpace(needed) {
      if (doc.y + needed > doc.page.height - 70) doc.addPage();
    }
    const levelBadge = (level, x, y) => {
      const text = String(level).toUpperCase();
      const w = doc.font("Helvetica-Bold").fontSize(8).widthOfString(text) + 12;
      doc.roundedRect(x, y, w, 14, 3).fill(COLORS[level] ?? COLORS.muted);
      doc.fillColor("#ffffff").text(text, x + 6, y + 3.5, { lineBreak: false });
      doc.fillColor(COLORS.ink);
      return w;
    };

    // ---------- title ----------
    doc.font("Helvetica-Bold").fontSize(20).fillColor(COLORS.ink).text("Financial Risk Report");
    doc.font("Helvetica").fontSize(11).fillColor(COLORS.muted)
      .text(`${data.company ?? "Unknown company"}  |  ${data.fiscal_year ?? "Unknown period"}`);
    doc.moveDown(0.3);
    small(
      `Source document: ${report.document?.filename ?? "-"}   |   Generated: ${new Date().toLocaleString("en-GB")}   |   Report id: ${report.id}`
    );

    const methodText = (g) => g?.method === "llm"
      ? `LLM (${g.provider}, ${g.model})`
      : "Rule-based fallback (LLM unavailable)";
    small(
      `Analysis plan: ${methodText(report.analysis_plan?.generated_by)}   |   Risk assessment: ${methodText(risk.generated_by)}   |   Ratios: deterministic Calculation Engine`
    );

    // ---------- overall ----------
    doc.moveDown(1);
    const boxY = doc.y;
    const overall = risk.overall_assessment;
    doc.roundedRect(50, boxY, width, 20, 4).fill("#f2f5f9");
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(11)
      .text("Overall risk level", 60, boxY + 5, { lineBreak: false });
    levelBadge(overall.level, 170, boxY + 3);
    doc.y = boxY + 28;
    doc.x = 50;
    body(overall.summary || "-");

    // ---------- categories ----------
    if (risk.category_assessments?.length) {
      heading("Risk by category");
      for (const c of risk.category_assessments) {
        ensureSpace(40);
        const y = doc.y;
        doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.ink)
          .text(label(c.category), 50, y, { lineBreak: false });
        levelBadge(c.level, 170, y - 2);
        doc.y = y + 15;
        doc.x = 50;
        body(c.summary || "");
        doc.moveDown(0.4);
      }
    }

    // ---------- risk factors ----------
    if (risk.risk_factors?.length) {
      heading("Risk factors and evidence");
      for (const f of risk.risk_factors) {
        ensureSpace(70);
        const y = doc.y;
        doc.font("Helvetica-Bold").fontSize(10.5).fillColor(COLORS.ink)
          .text(`${f.id}. ${f.title}`, 50, y, { width: width - 90 });
        const afterTitle = doc.y;
        levelBadge(f.level, 50 + width - 70, y);
        doc.y = afterTitle;
        doc.x = 50;
        small(label(f.category));
        doc.moveDown(0.2);
        if (f.interpretation) body(f.interpretation);
        const ev = f.evidence
          .map((e) => `${e.name ?? label(e.key)} = ${formatValue(e.value, e.unit)}`)
          .join("; ");
        doc.moveDown(0.2);
        small(`Evidence: ${ev}`);
        if (f.knowledge_refs?.length) small(`Knowledge: ${f.knowledge_refs.join(", ")}`);
        doc.moveDown(0.6);
      }
    }

    // ---------- recommendations ----------
    if (risk.recommendations?.length) {
      heading("Recommendations");
      for (const r of risk.recommendations) {
        bullet(r.related_risk_factors?.length
          ? `${r.text} (${r.related_risk_factors.join(", ")})`
          : r.text);
      }
    }

    // ---------- ratios table ----------
    heading("Financial ratios (Calculation Engine)");
    const ratios = Object.entries(analysis.calculated_ratios ?? {});
    const cols = [50, 200, 270, 50 + width];
    const row = (cells, bold = false) => {
      ensureSpace(24);
      const y = doc.y;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(COLORS.ink);
      doc.text(cells[0], cols[0], y, { width: cols[1] - cols[0] - 6 });
      const h1 = doc.y;
      doc.text(cells[1], cols[1], y, { width: cols[2] - cols[1] - 6, align: "right" });
      doc.font("Helvetica").fillColor(COLORS.muted)
        .text(cells[2], cols[2] + 10, y, { width: cols[3] - cols[2] - 10 });
      doc.y = Math.max(h1, doc.y) + 3;
      doc.x = 50;
    };
    row(["Ratio", "Value", "Formula"], true);
    let lastCategory = null;
    for (const [, r] of ratios) {
      if (r.category !== lastCategory) {
        lastCategory = r.category;
        ensureSpace(30);
        doc.moveDown(0.2);
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLORS.accent)
          .text((CATEGORY_LABELS[r.category] ?? label(r.category)).toUpperCase(), 50);
      }
      row([r.name, formatValue(r.value, r.unit), r.formula]);
    }

    // ---------- unavailable ----------
    if (analysis.unavailable_calculations?.length) {
      doc.moveDown(0.5);
      small("Not calculated (required values missing, never estimated):");
      for (const u of analysis.unavailable_calculations) {
        small(`   ${u.name ?? label(u.calculation)}: missing ${u.missing_keys.join(", ") || u.reason}`);
      }
    }

    // ---------- observations ----------
    if (analysis.observations?.length) {
      heading("Analysis observations");
      for (const o of analysis.observations) {
        bullet(`${label(o.key)} (${Number(o.value).toLocaleString("en-US")}): ${o.reason}`);
      }
    }

    // ---------- extracted data ----------
    heading("Extracted financial data (USD millions unless stated)");
    const entries = Object.entries(data).filter(([k]) => !["company", "fiscal_year"].includes(k));
    const half = Math.ceil(entries.length / 2);
    const colW = width / 2;
    const startY = doc.y;
    entries.forEach(([k, v], i) => {
      const x = i < half ? 50 : 50 + colW;
      const y = startY + (i % half) * 13;
      if (y > doc.page.height - 70) return;
      doc.font("Helvetica").fontSize(8.5).fillColor(COLORS.muted).text(label(k), x, y, { width: colW * 0.6 });
      doc.fillColor(COLORS.ink).text(v === null ? "not disclosed" : formatValue(v), x + colW * 0.6, y,
        { width: colW * 0.35, align: "right" });
    });
    doc.y = startY + half * 13 + 6;
    doc.x = 50;

    // ---------- limitations ----------
    const limits = [...(risk.limitations ?? [])];
    if (risk.benchmarks_unavailable?.length) {
      limits.push(`Benchmarks not available: ${risk.benchmarks_unavailable.join("; ")}.`);
    }
    if (limits.length) {
      heading("Limitations");
      limits.forEach(bullet);
    }

    if (risk.validation_notes?.length) {
      heading("Validation notes");
      risk.validation_notes.forEach(bullet);
    }

    // ---------- sources ----------
    if (risk.retrieved_knowledge?.length) {
      heading("Knowledge sources used");
      for (const k of risk.retrieved_knowledge) {
        small(`${k.id}: ${k.title}  (${k.source})`);
      }
    }

    doc.moveDown(1);
    small(
      "This report was generated automatically by FinRisk, a student project. It is an analytical aid, not investment, credit or audit advice."
    );

    // ---------- page numbers ----------
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // footer sits in the margin; stops pdfkit adding a page
      doc.font("Helvetica").fontSize(8).fillColor(COLORS.muted).text(
        `FinRisk  |  Page ${i + 1} of ${range.count}`,
        50, doc.page.height - 40, { width, align: "center", lineBreak: false }
      );
    }

    doc.end();
  });
}
