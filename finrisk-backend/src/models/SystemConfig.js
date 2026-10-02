import mongoose from "mongoose";

// One document (key "system") holding settings the admin can change
// at runtime. API keys are NOT stored here — they stay in .env.
const systemConfigSchema = new mongoose.Schema(
  {
    key: { type: String, default: "system", unique: true },
    processing: { type: mongoose.Schema.Types.Mixed, default: {} },
    llm: { type: mongoose.Schema.Types.Mixed, default: {} },
    rag: { type: mongoose.Schema.Types.Mixed, default: {} },
    updated_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
  },
  { timestamps: true, minimize: false }
);

export default mongoose.model("SystemConfig", systemConfigSchema);
