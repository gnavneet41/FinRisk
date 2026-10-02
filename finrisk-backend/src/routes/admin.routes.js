// ============================================================
// ADMIN ROUTES  (role "admin" only)
// ------------------------------------------------------------
// Users
//   GET   /api/admin/users
//   POST  /api/admin/users                     create account
//   PATCH /api/admin/users/:id                 role / company / activate / deactivate / name
//   POST  /api/admin/users/:id/reset-access    temporary password + sign out everywhere
// Companies
//   GET   /api/admin/companies                 (metadata + counts only, no company data)
//   POST  /api/admin/companies
//   PATCH /api/admin/companies/:id             details / activate / subscription
// System
//   GET   /api/admin/system/config
//   PUT   /api/admin/system/config/:section    processing | llm | rag
//   DELETE /api/admin/system/config/:section   reset to .env / defaults
//   POST  /api/admin/system/llm/test           one small LLM call
//   POST  /api/admin/system/rag/rebuild        clear the retrieval index cache
//   GET   /api/admin/system/monitoring
// ============================================================

import express from "express";
import mongoose from "mongoose";
import User, { ROLES } from "../models/User.js";
import Company from "../models/Company.js";
import FinancialDocument from "../models/FinancialDocument.js";
import KnowledgeDocument from "../models/KnowledgeDocument.js";
import { requireAuth, requireRole, asyncHandler } from "../middleware/auth.js";
import { generateTemporaryPassword } from "../services/auth.service.js";
import { getConfig, updateConfig, resetConfigSection, getOverriddenKeys } from "../services/systemConfig.service.js";
import { getLlmStatus, generateJson } from "../services/llm.service.js";
import { invalidateKnowledgeCache } from "../services/knowledgeBase.service.js";
import { getMonitoringStats, logEvent } from "../services/monitoring.service.js";

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

const bad = (res, message, status = 400) => res.status(status).json({ success: false, message });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ============================================================
// USERS
// ============================================================

router.get("/users", asyncHandler(async (req, res) => {
  const users = await User.find({}).populate("company", "name").sort({ createdAt: -1 });
  res.json({ success: true, roles: ROLES, users: users.map((u) => u.toPublic()) });
}));

async function companyForRole(role, companyId) {
  if (role === "admin") {
    if (companyId) throw Object.assign(new Error("Administrators cannot belong to a company"), { status: 400 });
    return null;
  }
  if (!companyId || !mongoose.isValidObjectId(companyId)) {
    throw Object.assign(new Error("Company users need a company"), { status: 400 });
  }
  const company = await Company.findById(companyId);
  if (!company) throw Object.assign(new Error("Company not found"), { status: 404 });
  return company;
}

async function checkSeat(company, excludeUserId = null) {
  const active = await User.countDocuments({
    company: company._id, is_active: true, ...(excludeUserId ? { _id: { $ne: excludeUserId } } : {})
  });
  if (active >= company.subscription.max_users) {
    throw Object.assign(
      new Error(`${company.name} has reached its limit of ${company.subscription.max_users} active users`),
      { status: 409 }
    );
  }
}

router.post("/users", asyncHandler(async (req, res) => {
  const { name, email, role = "analyst", company_id: companyId, password } = req.body ?? {};
  if (!String(name ?? "").trim()) return bad(res, "Name is required");
  if (!EMAIL.test(String(email ?? ""))) return bad(res, "A valid email is required");
  if (!ROLES.includes(role)) return bad(res, `Role must be one of: ${ROLES.join(", ")}`);
  if (await User.exists({ email: String(email).toLowerCase() })) return bad(res, "A user with this email already exists", 409);

  const company = await companyForRole(role, companyId);
  if (company) await checkSeat(company);

  const temporary = password ? null : generateTemporaryPassword();
  const user = new User({
    name: String(name).trim(),
    email,
    role,
    company: company?._id ?? null,
    must_change_password: true // always set their own password on first sign-in
  });
  await user.setPassword(password || temporary);
  await user.save();
  await user.populate("company", "name");

  logEvent("admin", `User created: ${user.email} (${role})`, { user: req.user._id, company: company?._id ?? null });
  res.status(201).json({ success: true, user: user.toPublic(), temporary_password: temporary });
}));

router.patch("/users/:id", asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "User not found", 404);
  const user = await User.findById(req.params.id);
  if (!user) return bad(res, "User not found", 404);

  const isSelf = user._id.equals(req.user._id);
  const b = req.body ?? {};
  const role = b.role ?? user.role;
  const companyId = b.company_id !== undefined ? b.company_id : user.company?.toString() ?? null;

  if (!ROLES.includes(role)) return bad(res, "Invalid role");
  if (isSelf && (role !== "admin" || b.is_active === false)) {
    return bad(res, "You cannot remove your own admin role or deactivate yourself");
  }

  const roleOrCompanyChanged = role !== user.role || String(companyId ?? "") !== String(user.company ?? "");
  const activating = b.is_active === true && !user.is_active;

  if (roleOrCompanyChanged || activating) {
    const company = await companyForRole(role, role === "admin" ? null : companyId);
    if (company && (activating || String(company._id) !== String(user.company ?? ""))) {
      await checkSeat(company, user._id);
    }
    user.company = company?._id ?? null;
  }

  if (b.name !== undefined && String(b.name).trim()) user.name = String(b.name).trim();
  if (role !== user.role) user.role = role;
  if (b.is_active !== undefined) user.is_active = Boolean(b.is_active);
  // Any change of role, company or status signs the user out everywhere.
  if (roleOrCompanyChanged || b.is_active !== undefined) user.token_version += 1;

  await user.save();
  await user.populate("company", "name");
  logEvent("admin", `User updated: ${user.email}`, { user: req.user._id, meta: { role: user.role, is_active: user.is_active } });
  res.json({ success: true, user: user.toPublic() });
}));

router.post("/users/:id/reset-access", asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "User not found", 404);
  const user = await User.findById(req.params.id);
  if (!user) return bad(res, "User not found", 404);

  const temporary = generateTemporaryPassword();
  await user.setPassword(temporary);
  user.must_change_password = true;
  user.token_version += 1; // signs out all existing sessions
  await user.save();

  logEvent("admin", `Access reset: ${user.email}`, { user: req.user._id });
  res.json({ success: true, temporary_password: temporary });
}));

// ============================================================
// COMPANIES
// ============================================================

function companyToClient(c, counts = {}) {
  return {
    id: c._id.toString(),
    name: c.name,
    industry: c.industry,
    contact_email: c.contact_email,
    is_active: c.is_active,
    subscription: c.subscription,
    access_problem: c.accessProblem ? c.accessProblem() : null,
    created_at: c.createdAt,
    // Counts only. The admin never sees company documents or private knowledge.
    users: counts.users ?? 0,
    documents: counts.documents ?? 0,
    documents_this_month: counts.documents_this_month ?? 0,
    private_knowledge_documents: counts.knowledge ?? 0
  };
}

router.get("/companies", asyncHandler(async (req, res) => {
  const companies = await Company.find({}).sort({ name: 1 });
  const month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const result = [];
  for (const c of companies) {
    const [users, documents, monthDocs, knowledge] = await Promise.all([
      User.countDocuments({ company: c._id }),
      FinancialDocument.countDocuments({ company: c._id }),
      FinancialDocument.countDocuments({ company: c._id, createdAt: { $gte: month } }),
      KnowledgeDocument.countDocuments({ scope: "company", company: c._id })
    ]);
    result.push(companyToClient(c, { users, documents, documents_this_month: monthDocs, knowledge }));
  }
  res.json({ success: true, companies: result });
}));

const PLANS = ["trial", "standard", "enterprise"];

function applySubscription(company, s) {
  if (!s) return;
  if (s.plan !== undefined) {
    if (!PLANS.includes(s.plan)) throw Object.assign(new Error("Invalid plan"), { status: 400 });
    company.subscription.plan = s.plan;
  }
  if (s.status !== undefined) {
    if (!["active", "suspended"].includes(s.status)) throw Object.assign(new Error("Invalid status"), { status: 400 });
    company.subscription.status = s.status;
  }
  if (s.expires_at !== undefined) {
    const d = s.expires_at ? new Date(s.expires_at) : null;
    if (d && Number.isNaN(d.getTime())) throw Object.assign(new Error("Invalid expiry date"), { status: 400 });
    company.subscription.expires_at = d;
  }
  for (const key of ["max_users", "max_documents_per_month"]) {
    if (s[key] !== undefined) {
      const n = Number(s[key]);
      if (!Number.isInteger(n) || n < (key === "max_users" ? 1 : 0) || n > 100000) {
        throw Object.assign(new Error(`Invalid ${key}`), { status: 400 });
      }
      company.subscription[key] = n;
    }
  }
  for (const key of ["chat_enabled", "private_knowledge_enabled"]) {
    if (s[key] !== undefined) company.subscription[key] = Boolean(s[key]);
  }
}

router.post("/companies", asyncHandler(async (req, res) => {
  const b = req.body ?? {};
  const name = String(b.name ?? "").trim();
  if (!name) return bad(res, "Company name is required");
  if (await Company.exists({ name })) return bad(res, "A company with this name already exists", 409);
  if (b.contact_email && !EMAIL.test(b.contact_email)) return bad(res, "Contact email is not valid");

  const company = new Company({ name, industry: b.industry ?? "", contact_email: b.contact_email ?? "" });
  applySubscription(company, b.subscription);
  await company.save();
  logEvent("admin", `Company created: ${name}`, { user: req.user._id, company: company._id });
  res.status(201).json({ success: true, company: companyToClient(company) });
}));

router.patch("/companies/:id", asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, "Company not found", 404);
  const company = await Company.findById(req.params.id);
  if (!company) return bad(res, "Company not found", 404);

  const b = req.body ?? {};
  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (!name) return bad(res, "Company name is required");
    if (name !== company.name && (await Company.exists({ name }))) return bad(res, "Name already in use", 409);
    company.name = name;
  }
  if (b.industry !== undefined) company.industry = String(b.industry);
  if (b.contact_email !== undefined) {
    if (b.contact_email && !EMAIL.test(b.contact_email)) return bad(res, "Contact email is not valid");
    company.contact_email = b.contact_email;
  }
  if (b.is_active !== undefined) company.is_active = Boolean(b.is_active);
  applySubscription(company, b.subscription);
  await company.save();

  logEvent("admin", `Company updated: ${company.name}`, {
    user: req.user._id, company: company._id, meta: { is_active: company.is_active, plan: company.subscription.plan }
  });
  res.json({ success: true, company: companyToClient(company) });
}));

// ============================================================
// SYSTEM
// ============================================================

router.get("/system/config", (req, res) => {
  res.json({
    success: true,
    config: getConfig(),
    overridden: getOverriddenKeys(), // changed by an admin; the rest follows .env
    llm_status: getLlmStatus(),
    secrets_note: "API keys are read from the server's .env file and are never shown or stored in the database."
  });
});

router.put("/system/config/:section", asyncHandler(async (req, res) => {
  const updated = await updateConfig(req.params.section, req.body, req.user._id);
  if (req.params.section === "rag") invalidateKnowledgeCache();
  logEvent("admin", `System configuration changed: ${req.params.section}`, { user: req.user._id, meta: req.body });
  res.json({ success: true, section: req.params.section, config: updated, overridden: getOverriddenKeys(), llm_status: getLlmStatus() });
}));

router.delete("/system/config/:section", asyncHandler(async (req, res) => {
  const config = await resetConfigSection(req.params.section, req.user._id);
  if (req.params.section === "rag") invalidateKnowledgeCache();
  logEvent("admin", `System configuration reset to .env defaults: ${req.params.section}`, { user: req.user._id });
  res.json({ success: true, section: req.params.section, config, overridden: getOverriddenKeys(), llm_status: getLlmStatus() });
}));

router.post("/system/llm/test", asyncHandler(async (req, res) => {
  const started = Date.now();
  try {
    const { data, model, provider } = await generateJson(
      'Reply with exactly this JSON and nothing else: {"status": "ok"}',
      { label: "Connection test" }
    );
    res.json({ success: true, ok: data?.status === "ok", provider, model, latency_ms: Date.now() - started });
  } catch (error) {
    res.json({ success: true, ok: false, error: error.message, latency_ms: Date.now() - started });
  }
}));

router.post("/system/rag/rebuild", (req, res) => {
  invalidateKnowledgeCache();
  logEvent("admin", "Knowledge index rebuilt", { user: req.user._id });
  res.json({ success: true, message: "The retrieval index will be rebuilt on the next request." });
});

router.get("/system/monitoring", asyncHandler(async (req, res) => {
  res.json({ success: true, monitoring: await getMonitoringStats(), llm_status: getLlmStatus() });
}));

export default router;
