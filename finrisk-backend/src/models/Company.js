import mongoose from "mongoose";

// A customer organisation. Its users, documents and private
// knowledge are isolated from every other company.
const companySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    industry: { type: String, trim: true, default: "" },
    contact_email: { type: String, trim: true, lowercase: true, default: "" },
    is_active: { type: Boolean, default: true },

    // Subscription / access
    subscription: {
      plan: { type: String, enum: ["trial", "standard", "enterprise"], default: "trial" },
      status: { type: String, enum: ["active", "suspended"], default: "active" },
      expires_at: { type: Date, default: null }, // null = no expiry
      max_users: { type: Number, default: 5, min: 1 },
      max_documents_per_month: { type: Number, default: 20, min: 0 },
      chat_enabled: { type: Boolean, default: true },
      private_knowledge_enabled: { type: Boolean, default: true }
    }
  },
  { timestamps: true }
);

/** Why this company cannot use the app right now, or null if it can. */
companySchema.methods.accessProblem = function () {
  if (!this.is_active) return "Your company account is deactivated. Contact the FinRisk administrator.";
  if (this.subscription.status !== "active") return "Your company subscription is suspended.";
  if (this.subscription.expires_at && this.subscription.expires_at < new Date()) {
    return "Your company subscription has expired.";
  }
  return null;
};

export default mongoose.model("Company", companySchema);
