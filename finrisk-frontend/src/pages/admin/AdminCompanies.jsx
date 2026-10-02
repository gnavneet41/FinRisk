import { useCallback, useEffect, useState } from "react";
import { Building2, Plus } from "lucide-react";
import { api } from "../../lib/api.js";
import { Alert, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Toggle, cx } from "../../components/ui.jsx";
import { date, titleCase } from "../../lib/format.js";

const EMPTY = {
  name: "", industry: "", contact_email: "",
  subscription: { plan: "trial", status: "active", expires_at: "", max_users: 5, max_documents_per_month: 20, chat_enabled: true, private_knowledge_enabled: true }
};

export default function AdminCompanies() {
  const [companies, setCompanies] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    api.get("/api/admin/companies").then((r) => setCompanies(r.companies)).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggle(c) {
    try { await api.patch(`/api/admin/companies/${c.id}`, { is_active: !c.is_active }); load(); }
    catch (e) { setError(e.message); }
  }

  return (
    <>
      <PageHeader
        title="Companies"
        description="Company accounts, their status and subscription. You see usage counts only — company documents and private knowledge stay private."
        actions={<Button icon={Plus} onClick={() => setEditing(EMPTY)}>Create company</Button>}
      />
      {error && <Alert type="error" className="mb-4">{error}</Alert>}
      <Card>
        {!companies ? <Spinner /> : (
          <Table
            rowKey={(c) => c.id}
            rows={companies}
            empty={<EmptyState icon={Building2} title="No companies yet" action={<Button icon={Plus} onClick={() => setEditing(EMPTY)}>Create company</Button>} />}
            columns={[
              { key: "name", label: "Company", render: (c) => (
                <div><p className="font-medium text-slate-900">{c.name}</p><p className="text-xs text-slate-500">{c.industry || "—"}</p></div>
              ) },
              { key: "plan", label: "Plan", render: (c) => (
                <div><p className="font-medium text-slate-800">{titleCase(c.subscription.plan)}</p>
                  <p className="text-xs text-slate-500">{c.subscription.expires_at ? `Expires ${date(c.subscription.expires_at)}` : "No expiry"}</p></div>
              ) },
              { key: "usage", label: "Usage", render: (c) => (
                <div className="text-xs text-slate-600">
                  <p>{c.users} / {c.subscription.max_users} users</p>
                  <p>{c.documents_this_month} / {c.subscription.max_documents_per_month} documents this month</p>
                </div>
              ) },
              { key: "status", label: "Access", render: (c) => (
                <span className={cx("inline-flex items-center gap-1.5 text-sm", c.access_problem ? "text-amber-800" : "text-slate-700")}>
                  <span className={cx("size-2 rounded-full", c.access_problem ? (c.is_active ? "bg-amber-500" : "bg-slate-300") : "bg-emerald-500")} />
                  {!c.is_active ? "Deactivated" : c.access_problem ? (c.subscription.status === "suspended" ? "Suspended" : "Expired") : "Active"}
                </span>
              ) },
              { key: "actions", label: "", align: "right", render: (c) => (
                <div className="flex justify-end gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>Manage</Button>
                  <Button size="sm" variant={c.is_active ? "danger" : "secondary"} onClick={() => toggle(c)}>{c.is_active ? "Deactivate" : "Activate"}</Button>
                </div>
              ) }
            ]}
          />
        )}
      </Card>
      <CompanyForm company={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
    </>
  );
}

function CompanyForm({ company, onClose, onSaved }) {
  const isNew = company && !company.id;
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (company) {
      setForm({
        name: company.name, industry: company.industry ?? "", contact_email: company.contact_email ?? "",
        subscription: { ...EMPTY.subscription, ...company.subscription, expires_at: company.subscription?.expires_at?.slice(0, 10) ?? "" }
      });
      setError(null);
    }
  }, [company]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setSub = (k, v) => setForm({ ...form, subscription: { ...form.subscription, [k]: v } });

  async function save() {
    setBusy(true);
    setError(null);
    const s = form.subscription;
    const body = {
      name: form.name, industry: form.industry, contact_email: form.contact_email,
      subscription: {
        plan: s.plan, status: s.status, expires_at: s.expires_at || null,
        max_users: Number(s.max_users), max_documents_per_month: Number(s.max_documents_per_month),
        chat_enabled: s.chat_enabled, private_knowledge_enabled: s.private_knowledge_enabled
      }
    };
    try {
      if (isNew) await api.post("/api/admin/companies", body);
      else await api.patch(`/api/admin/companies/${company.id}`, body);
      onSaved();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const s = form.subscription;
  return (
    <Modal open={Boolean(company)} onClose={onClose} title={isNew ? "Create company" : `Manage ${company?.name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>{isNew ? "Create company" : "Save changes"}</Button></>}>
      <div className="space-y-5">
        <div className="space-y-4">
          <Field label="Company name"><Input value={form.name} onChange={set("name")} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Industry"><Input value={form.industry} onChange={set("industry")} /></Field>
            <Field label="Contact email"><Input type="email" value={form.contact_email} onChange={set("contact_email")} /></Field>
          </div>
        </div>
        <div className="space-y-4 border-t border-slate-100 pt-5">
          <h3 className="text-sm font-semibold text-slate-900">Subscription and access</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Plan">
              <Select value={s.plan} onChange={(e) => setSub("plan", e.target.value)}>
                {["trial", "standard", "enterprise"].map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
              </Select>
            </Field>
            <Field label="Subscription status">
              <Select value={s.status} onChange={(e) => setSub("status", e.target.value)}>
                <option value="active">Active</option><option value="suspended">Suspended</option>
              </Select>
            </Field>
            <Field label="Expires on" hint="Leave empty for no expiry."><Input type="date" value={s.expires_at} onChange={(e) => setSub("expires_at", e.target.value)} /></Field>
            <Field label="User seats"><Input type="number" min={1} value={s.max_users} onChange={(e) => setSub("max_users", e.target.value)} /></Field>
            <Field label="Documents per month"><Input type="number" min={0} value={s.max_documents_per_month} onChange={(e) => setSub("max_documents_per_month", e.target.value)} /></Field>
          </div>
          <Toggle checked={s.chat_enabled} onChange={(v) => setSub("chat_enabled", v)} label="Ask FinRisk" description="AI assistant for questions about analyses." />
          <Toggle checked={s.private_knowledge_enabled} onChange={(v) => setSub("private_knowledge_enabled", v)} label="Company knowledge" description="Private knowledge base for this company." />
        </div>
        {error && <Alert type="error">{error}</Alert>}
      </div>
    </Modal>
  );
}
