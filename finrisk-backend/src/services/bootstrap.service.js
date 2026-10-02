// ============================================================
// STARTUP: config, global knowledge, first admin account
// ============================================================

import User from "../models/User.js";
import { loadSystemConfig } from "./systemConfig.service.js";
import { seedGlobalKnowledge } from "./knowledgeBase.service.js";
import { recoverInterruptedAnalyses } from "./pipeline.service.js";
import { generateTemporaryPassword } from "./auth.service.js";

export async function bootstrap() {
  await loadSystemConfig();

  const seeded = await seedGlobalKnowledge();
  if (seeded) console.log(`[Knowledge Base] Created ${seeded} global knowledge documents`);

  const recovered = await recoverInterruptedAnalyses();
  if (recovered) console.log(`[Pipeline] Marked ${recovered} interrupted analyses as failed`);

  // First start: create the administrator account.
  if (!(await User.exists({ role: "admin" }))) {
    const email = (process.env.ADMIN_EMAIL || "admin@finrisk.local").toLowerCase();
    const password = process.env.ADMIN_PASSWORD || generateTemporaryPassword();
    const admin = new User({ name: "FinRisk Administrator", email, role: "admin", must_change_password: true });
    await admin.setPassword(password);
    await admin.save();
    console.log("\n============================================================");
    console.log(" Administrator account created");
    console.log(`   Email:    ${email}`);
    console.log(`   Password: ${process.env.ADMIN_PASSWORD ? "(ADMIN_PASSWORD from .env)" : password}`);
    console.log(" You will be asked to choose a new password at first sign-in.");
    console.log("============================================================\n");
  }
}
