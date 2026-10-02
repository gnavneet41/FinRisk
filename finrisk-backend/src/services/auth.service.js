// ============================================================
// AUTH: JWT login tokens
// ============================================================

import crypto from "crypto";
import jwt from "jsonwebtoken";

const TOKEN_LIFETIME = "8h";

let generatedSecret = null;

function secret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  // Development fallback: random secret per server start (logins reset on restart).
  if (!generatedSecret) {
    generatedSecret = crypto.randomBytes(32).toString("hex");
    console.warn("[Auth] JWT_SECRET not set in .env — using a temporary secret. Logins reset on restart.");
  }
  return generatedSecret;
}

export function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), v: user.token_version, role: user.role },
    secret(),
    { expiresIn: TOKEN_LIFETIME }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, secret());
}

/** Readable random password for "reset access", e.g. Kx7m-Qp2r-Zt9w */
export function generateTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const group = () =>
    Array.from(crypto.randomBytes(4), (b) => alphabet[b % alphabet.length]).join("");
  return `${group()}-${group()}-${group()}`;
}
