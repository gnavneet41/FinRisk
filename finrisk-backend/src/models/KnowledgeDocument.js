import mongoose from "mongoose";

// Knowledge used by the Risk Advisor and the chatbot (RAG).
//   scope "global"  - managed by the admin, used by every company
//   scope "company" - private to one company, managed by its analysts;
//                     the admin has no access to these
export const GLOBAL_CATEGORIES = [
  "accounting_standards",
  "ratio_definitions",
  "risk_methodology",
  "regulatory_guidance",
  "industry_information"
];

export const COMPANY_CATEGORIES = [
  "internal_policy",
  "company_document",
  "historical_report",
  "internal_financial"
];

const chunkSchema = new mongoose.Schema(
  {
    chunk_id: { type: String, required: true }, // cited as a source, e.g. K-LIQ-01
    heading: { type: String, default: "" },
    text: { type: String, required: true },
    applies_to: { type: [String], default: [] } // ratio / data keys for exact matching
  },
  { _id: false }
);

const knowledgeSchema = new mongoose.Schema(
  {
    scope: { type: String, enum: ["global", "company"], required: true, index: true },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", default: null, index: true },
    title: { type: String, required: true, trim: true },
    category: { type: String, required: true },
    source: { type: String, default: "" }, // citation / origin
    description: { type: String, default: "" },
    content: { type: String, default: "" },
    chunks: { type: [chunkSchema], default: [] },
    is_active: { type: Boolean, default: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // For historical reports generated from an analysis
    source_document: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialDocument", default: null }
  },
  { timestamps: true }
);

export default mongoose.model("KnowledgeDocument", knowledgeSchema);
