// ============================================================
// DEMO DATA
//   npm run seed
// Creates (if missing):
//   - the global knowledge base
//   - admin       admin@finrisk.local     / Admin@12345
//   - company     FinRisk Demo Company
//   - analyst     analyst@demo.finrisk    / Analyst@12345
//   - viewer      viewer@demo.finrisk     / Viewer@12345
//   - the Apple Inc. FY2024 sample analysed as a completed document
// Demo passwords are for local testing only.
// ============================================================

import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import { connectDatabase } from "../config/db.js";
import User from "../models/User.js";
import Company from "../models/Company.js";
import FinancialDocument from "../models/FinancialDocument.js";
import { loadSystemConfig } from "../services/systemConfig.service.js";
import { seedGlobalKnowledge } from "../services/knowledgeBase.service.js";
import { processUpload, runAnalysis } from "../services/pipeline.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PDF = path.join(__dirname, "..", "..", "test", "fixtures", "apple.pdf");

async function ensureUser({ name, email, role, company, password }) {
  let user = await User.findOne({ email });
  if (user) return { user, created: false };
  user = new User({ name, email, role, company: company?._id ?? null });
  await user.setPassword(password);
  await user.save();
  return { user, created: true };
}

await connectDatabase();
await loadSystemConfig();
console.log(`Global knowledge documents created: ${await seedGlobalKnowledge()}`);

const admin = await ensureUser({
  name: "FinRisk Administrator", email: "admin@finrisk.local", role: "admin", password: "Admin@12345"
});

let company = await Company.findOne({ name: "FinRisk Demo Company" });
if (!company) {
  company = await Company.create({
    name: "FinRisk Demo Company",
    industry: "Financial analysis",
    contact_email: "contact@demo.finrisk",
    subscription: { plan: "standard", max_users: 10, max_documents_per_month: 50 }
  });
}

const analyst = await ensureUser({
  name: "Priya Analyst", email: "analyst@demo.finrisk", role: "analyst", company, password: "Analyst@12345"
});
await ensureUser({
  name: "Vikram Viewer", email: "viewer@demo.finrisk", role: "viewer", company, password: "Viewer@12345"
});

if (!(await FinancialDocument.exists({ company: company._id }))) {
  console.log("Analysing the Apple Inc. FY2024 sample (this makes 2 LLM calls if an LLM is configured)...");
  const copy = path.join("uploads", String(company._id), `${Date.now()}-Apple_10K_Simplified_Financial_Report.pdf`);
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  fs.copyFileSync(SAMPLE_PDF, copy);

  const user = await User.findById(analyst.user._id).populate("company");
  const file = {
    originalname: "Apple_10K_Simplified_Financial_Report.pdf",
    mimetype: "application/pdf",
    size: fs.statSync(copy).size,
    path: copy
  };
  const doc = await processUpload({ file, user });
  // processUpload starts the analysis in the background; wait for it here.
  if (doc.status === "analyzing" || doc.status === "validated") {
    await new Promise((r) => setTimeout(r, 200));
    let current = await FinancialDocument.findById(doc._id);
    if (current.status === "validated") await runAnalysis(doc._id);
    for (let i = 0; i < 300 && current.status === "analyzing"; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      current = await FinancialDocument.findById(doc._id);
    }
    console.log(`Sample document status: ${current.status} (overall risk: ${current.overall_risk_level ?? "-"})`);
  } else {
    console.log(`Sample document status: ${doc.status}`);
  }
}

console.log("\nDemo accounts (local testing only):");
console.log(`  Admin    admin@finrisk.local    Admin@12345   ${admin.created ? "(created)" : "(already existed)"}`);
console.log("  Analyst  analyst@demo.finrisk   Analyst@12345");
console.log("  Viewer   viewer@demo.finrisk    Viewer@12345\n");

await mongoose.disconnect();
