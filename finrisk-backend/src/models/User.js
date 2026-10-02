import mongoose from "mongoose";
import bcrypt from "bcryptjs";

// Roles:
//   admin   - FinRisk platform administrator. Manages users, companies,
//             system settings and the GLOBAL knowledge base. Belongs to no
//             company, so it has no access to company documents or private
//             company knowledge.
//   analyst - company user: uploads documents, runs analyses, manages the
//             company's private knowledge base.
//   viewer  - company user: read-only access to analyses, reports and chat.
export const ROLES = ["admin", "analyst", "viewer"];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password_hash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: "analyst" },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", default: null },
    is_active: { type: Boolean, default: true },
    must_change_password: { type: Boolean, default: false },
    // Incremented on password reset / deactivation so old login tokens stop working.
    token_version: { type: Number, default: 0 },
    last_login_at: { type: Date, default: null }
  },
  { timestamps: true }
);

userSchema.methods.setPassword = async function (password) {
  if (typeof password !== "string" || password.length < 8) {
    throw Object.assign(new Error("Password must be at least 8 characters"), { status: 400 });
  }
  this.password_hash = await bcrypt.hash(password, 10);
};

userSchema.methods.checkPassword = function (password) {
  return bcrypt.compare(String(password ?? ""), this.password_hash);
};

/** Safe public shape (never includes the password hash). */
userSchema.methods.toPublic = function () {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    role: this.role,
    company: this.company && this.company._id
      ? { id: this.company._id.toString(), name: this.company.name }
      : this.company ? { id: this.company.toString() } : null,
    is_active: this.is_active,
    must_change_password: this.must_change_password,
    last_login_at: this.last_login_at,
    created_at: this.createdAt
  };
};

export default mongoose.model("User", userSchema);
