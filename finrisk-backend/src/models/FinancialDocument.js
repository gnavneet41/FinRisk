import mongoose from "mongoose";

// One uploaded financial document and everything produced from it:
// extracted values, validation, analysis plan, ratios, risk assessment
// and the PDF report. Always belongs to exactly one company.
export const DOCUMENT_STATUSES = [
  "uploaded",
  "extracted",
  "validated",
  "needs_review", // validation failed: user must correct values
  "analyzing",
  "completed",
  "failed"
];

const documentSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    uploaded_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    filename: { type: String, required: true },
    mimetype: String,
    file_type: { type: String, enum: ["pdf", "docx", "csv", "xlsx"] },
    size_bytes: Number,
    storage_path: { type: String, select: false },

    status: { type: String, enum: DOCUMENT_STATUSES, default: "uploaded", index: true },
    status_history: [{ _id: false, status: String, at: Date, message: String }],
    error: { stage: String, message: String, detail: String },

    // Copied out of the extracted data for fast listing
    company_name: { type: String, default: null },
    fiscal_year: { type: String, default: null },

    extracted_data: { type: mongoose.Schema.Types.Mixed, default: null }, // never overwritten
    financial_data: { type: mongoose.Schema.Types.Mixed, default: null }, // may contain corrections
    corrected_fields: { type: Array, default: [] },
    validation: { type: mongoose.Schema.Types.Mixed, default: null },
    analysis_plan: { type: mongoose.Schema.Types.Mixed, default: null },
    analysis: { type: mongoose.Schema.Types.Mixed, default: null },
    risk_assessment: { type: mongoose.Schema.Types.Mixed, default: null },

    overall_risk_level: { type: String, default: null },
    pdf_path: { type: String, default: null, select: false },
    pdf_generated: { type: Boolean, default: false },
    analyzed_at: { type: Date, default: null }
  },
  { timestamps: true, minimize: false }
);

documentSchema.methods.setStatus = function (status, message = "") {
  this.status = status;
  this.status_history.push({ status, at: new Date(), message });
};

export default mongoose.model("FinancialDocument", documentSchema);
