// ============================================================
// AUTH ROUTES
//   POST /api/auth/login             { email, password }
//   GET  /api/auth/me
//   POST /api/auth/change-password   { current_password, new_password }
//   PATCH /api/auth/profile          { name }
// ============================================================

import express from "express";
import User from "../models/User.js";
import { requireAuth, asyncHandler } from "../middleware/auth.js";
import { signToken } from "../services/auth.service.js";
import { logEvent } from "../services/monitoring.service.js";

const router = express.Router();

// Simple in-memory brute-force protection: 10 failed attempts per email per 15 minutes.
const failedLogins = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

router.post("/login", asyncHandler(async (req, res) => {
  const email = String(req.body?.email ?? "").toLowerCase().trim();
  const password = String(req.body?.password ?? "");

  const record = failedLogins.get(email);
  if (record && record.count >= MAX_FAILURES && Date.now() - record.first < WINDOW_MS) {
    return res.status(429).json({ success: false, message: "Too many failed attempts. Try again in 15 minutes." });
  }

  const user = await User.findOne({ email }).select("+password_hash").populate("company");
  const valid = user && (await user.checkPassword(password));

  if (!valid) {
    const r = record && Date.now() - record.first < WINDOW_MS ? record : { count: 0, first: Date.now() };
    r.count++;
    failedLogins.set(email, r);
    logEvent("auth", `Failed login for ${email}`, { level: "warning" });
    return res.status(401).json({ success: false, message: "Email or password is incorrect" });
  }
  failedLogins.delete(email);

  if (!user.is_active) {
    return res.status(403).json({ success: false, message: "Your account is deactivated. Contact your administrator." });
  }
  if (user.role !== "admin") {
    const problem = user.company ? user.company.accessProblem() : "Your account is not linked to a company.";
    if (problem) return res.status(403).json({ success: false, message: problem });
  }

  user.last_login_at = new Date();
  await user.save();
  logEvent("auth", `Login: ${user.email}`, { user: user._id, company: user.company?._id ?? null });

  res.json({ success: true, token: signToken(user), user: publicUser(user) });
}));

router.get("/me", requireAuth, (req, res) => {
  res.json({ success: true, user: publicUser(req.user) });
});

router.post("/change-password", requireAuth, asyncHandler(async (req, res) => {
  const { current_password: current, new_password: next } = req.body ?? {};
  const user = await User.findById(req.user._id).select("+password_hash").populate("company");

  if (!(await user.checkPassword(current))) {
    return res.status(400).json({ success: false, message: "Current password is incorrect" });
  }
  if (current === next) {
    return res.status(400).json({ success: false, message: "Choose a password different from the current one" });
  }
  await user.setPassword(next);
  user.must_change_password = false;
  user.token_version += 1; // log out other sessions
  await user.save();
  logEvent("auth", `Password changed: ${user.email}`, { user: user._id });

  res.json({ success: true, token: signToken(user), user: publicUser(user) });
}));

router.patch("/profile", requireAuth, asyncHandler(async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ success: false, message: "Name is required" });
  req.user.name = name.slice(0, 80);
  await req.user.save();
  res.json({ success: true, user: publicUser(req.user) });
}));

/** User + the company's subscription summary (what the frontend needs). */
export function publicUser(user) {
  const base = user.toPublic();
  if (user.company && user.company.subscription) {
    const s = user.company.subscription;
    base.company = {
      id: user.company._id.toString(),
      name: user.company.name,
      industry: user.company.industry,
      subscription: {
        plan: s.plan,
        status: s.status,
        expires_at: s.expires_at,
        max_users: s.max_users,
        max_documents_per_month: s.max_documents_per_month,
        chat_enabled: s.chat_enabled,
        private_knowledge_enabled: s.private_knowledge_enabled
      }
    };
  }
  return base;
}

export default router;
