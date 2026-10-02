import mongoose from "mongoose";

// Events for system monitoring: LLM calls, pipeline runs, logins, admin actions.
// Stores metadata only — never document contents.
const activitySchema = new mongoose.Schema(
  {
    type: { type: String, required: true, index: true }, // llm_call | pipeline | auth | admin
    level: { type: String, enum: ["info", "warning", "error"], default: "info" },
    message: { type: String, default: "" },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", default: null },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

activitySchema.index({ createdAt: -1 });

export default mongoose.model("ActivityLog", activitySchema);
