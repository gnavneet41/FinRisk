// ============================================================
// AUTH MIDDLEWARE
// ------------------------------------------------------------
// requireAuth     -> valid token, active user, active company
// requireRole(..) -> user has one of the roles
// requireCompany  -> user belongs to a company (admins do not),
//                    which is what keeps company data private
// ============================================================

import User from "../models/User.js";
import { verifyToken } from "../services/auth.service.js";

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, message: "Please sign in" });

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ success: false, message: "Your session has expired. Please sign in again." });
  }

  const user = await User.findById(payload.sub).populate("company");
  if (!user || user.token_version !== payload.v) {
    return res.status(401).json({ success: false, message: "Your session is no longer valid. Please sign in again." });
  }
  if (!user.is_active) {
    return res.status(403).json({ success: false, message: "Your account is deactivated." });
  }
  if (user.role !== "admin") {
    const problem = user.company ? user.company.accessProblem() : "Your account is not linked to a company.";
    if (problem) return res.status(403).json({ success: false, message: problem });
  }

  // A user with a temporary password may only change it.
  const allowedWhileTemporary = ["/api/auth/me", "/api/auth/change-password"];
  if (user.must_change_password && !allowedWhileTemporary.includes(req.originalUrl.split("?")[0])) {
    return res.status(403).json({
      success: false,
      code: "PASSWORD_CHANGE_REQUIRED",
      message: "Set a new password before continuing."
    });
  }

  req.user = user;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "You do not have permission to do this." });
    }
    next();
  };
}

export function requireCompany(req, res, next) {
  if (!req.user.company) {
    return res.status(403).json({
      success: false,
      message: "This area contains company data. Administrators do not have access to company documents or private knowledge."
    });
  }
  req.companyId = req.user.company._id;
  next();
}

/** Wraps async route handlers so thrown errors reach the error handler. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
