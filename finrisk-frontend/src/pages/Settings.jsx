import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { useAuth, isAdmin } from "../lib/auth.jsx";
import { Alert, Button, Card, CardHeader, Field, Input, PageHeader, Pill } from "../components/ui.jsx";
import { PasswordForm } from "./ChangePassword.jsx";
import { date, titleCase } from "../lib/format.js";

export default function Settings() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user.name);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [health, setHealth] = useState(null);

  useEffect(() => { api.get("/api/health").then(setHealth).catch(() => {}); }, []);

  async function saveProfile(e) {
    e.preventDefault();
    setSaved(false);
    setError(null);
    try {
      const r = await api.patch("/api/auth/profile", { name });
      setUser(r.user);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    }
  }

  const s = user.company?.subscription;

  return (
    <>
      <PageHeader title="Settings" description="Your profile, password and account details." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" />
          <form onSubmit={saveProfile} className="space-y-4 p-5">
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
            <Field label="Email" hint="Ask your administrator to change your email."><Input value={user.email} disabled /></Field>
            <Field label="Role"><Input value={isAdmin(user) ? "Administrator" : titleCase(user.role)} disabled /></Field>
            {error && <Alert type="error">{error}</Alert>}
            {saved && <Alert type="success">Profile saved.</Alert>}
            <Button type="submit">Save profile</Button>
          </form>
        </Card>

        <Card>
          <CardHeader title="Password" subtitle="Changing your password signs out your other sessions." />
          <div className="p-5"><PasswordForm /></div>
        </Card>

        {s && (
          <Card>
            <CardHeader title="Company and plan" subtitle={user.company.name} />
            <dl className="divide-y divide-slate-100 text-sm">
              {[
                ["Plan", <Pill key="p">{titleCase(s.plan)}</Pill>],
                ["Status", titleCase(s.status)],
                ["Expires", s.expires_at ? date(s.expires_at) : "No expiry"],
                ["User seats", s.max_users],
                ["Documents per month", s.max_documents_per_month],
                ["Ask FinRisk", s.chat_enabled ? "Included" : "Not included"],
                ["Company knowledge", s.private_knowledge_enabled ? "Included" : "Not included"]
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between px-5 py-3">
                  <dt className="text-slate-500">{k}</dt><dd className="font-medium text-slate-800">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        )}

        <Card>
          <CardHeader title="AI service" subtitle="Configured by the FinRisk administrator" />
          <div className="space-y-3 p-5 text-sm text-slate-600">
            {health ? (
              <>
                <p>Language model: <span className="font-medium text-slate-800">{health.llm.configured ? titleCase(health.llm.provider) : "Not configured"}</span></p>
                <p>Rule-based fallback: <span className="font-medium text-slate-800">{health.llm.fallback_enabled ? "On" : "Off"}</span></p>
                <p className="text-xs text-slate-500">Ratios are always calculated in code. When the language model is unavailable, FinRisk uses documented rules and labels the result.</p>
              </>
            ) : <p>Loading…</p>}
            {isAdmin(user) && <Link to="/admin/system" className="inline-block font-medium text-brand-600 hover:text-brand-700">Open system configuration</Link>}
          </div>
        </Card>
      </div>
    </>
  );
}
