import { useCallback, useEffect, useState } from "react";
import { UserPlus, KeyRound, Copy } from "lucide-react";
import { api } from "../../lib/api.js";
import { useAuth } from "../../lib/auth.jsx";
import { Alert, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, Table, cx } from "../../components/ui.jsx";
import { dateTime, titleCase } from "../../lib/format.js";

const ROLE_HELP = {
  admin: "Platform administrator. No company; cannot see company documents or private knowledge.",
  analyst: "Uploads documents, runs analyses and manages company knowledge.",
  viewer: "Read-only access to analyses, reports and Ask FinRisk."
};

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // {} for new
  const [secret, setSecret] = useState(null);  // {email, password}
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    try {
      const [u, c] = await Promise.all([api.get("/api/admin/users"), api.get("/api/admin/companies")]);
      setUsers(u.users);
      setCompanies(c.companies);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggleActive(u) {
    try {
      await api.patch(`/api/admin/users/${u.id}`, { is_active: !u.is_active });
      load();
    } catch (e) { setError(e.message); }
  }

  async function resetAccess(u) {
    try {
      const r = await api.post(`/api/admin/users/${u.id}/reset-access`);
      setSecret({ email: u.email, password: r.temporary_password, reset: true });
    } catch (e) { setError(e.message); }
  }

  const shown = (users ?? []).filter((u) => !filter || u.company?.id === filter || (filter === "admins" && u.role === "admin"));

  return (
    <>
      <PageHeader
        title="Users"
        description="Create accounts, assign roles and companies, deactivate accounts and reset access."
        actions={<Button icon={UserPlus} onClick={() => setEditing({})}>Create user</Button>}
      />
      {error && <Alert type="error" className="mb-4">{error}</Alert>}
      <div className="mb-4 max-w-xs">
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by company">
          <option value="">All users</option>
          <option value="admins">Administrators</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>
      <Card>
        {!users ? <Spinner /> : (
          <Table
            rowKey={(u) => u.id}
            rows={shown}
            columns={[
              { key: "name", label: "User", render: (u) => (
                <div><p className="font-medium text-slate-900">{u.name}{u.id === me.id && <span className="ml-2 text-xs text-slate-400">(you)</span>}</p><p className="text-xs text-slate-500">{u.email}</p></div>
              ) },
              { key: "role", label: "Role", render: (u) => <span className={cx("rounded-md px-2 py-0.5 text-xs font-medium",
                u.role === "admin" ? "bg-slate-900 text-white" : u.role === "analyst" ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-700")}>{titleCase(u.role)}</span> },
              { key: "company", label: "Company", render: (u) => u.company?.name ?? <span className="text-slate-400">—</span> },
              { key: "status", label: "Status", render: (u) => (
                <span className="inline-flex items-center gap-1.5 text-sm">
                  <span className={cx("size-2 rounded-full", u.is_active ? "bg-emerald-500" : "bg-slate-300")} />
                  {u.is_active ? (u.must_change_password ? "Pending first sign-in" : "Active") : "Deactivated"}
                </span>
              ) },
              { key: "login", label: "Last sign-in", className: "whitespace-nowrap text-slate-500", render: (u) => dateTime(u.last_login_at) },
              { key: "actions", label: "", align: "right", render: (u) => (
                <div className="flex justify-end gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(u)}>Edit</Button>
                  {u.id !== me.id && <>
                    <Button size="sm" variant="secondary" icon={KeyRound} onClick={() => resetAccess(u)}>Reset access</Button>
                    <Button size="sm" variant={u.is_active ? "danger" : "secondary"} onClick={() => toggleActive(u)}>
                      {u.is_active ? "Deactivate" : "Activate"}
                    </Button>
                  </>}
                </div>
              ) }
            ]}
          />
        )}
      </Card>

      <UserForm user={editing} companies={companies} me={me} onClose={() => setEditing(null)}
        onSaved={(r) => { setEditing(null); load(); if (r?.temporary_password) setSecret({ email: r.user.email, password: r.temporary_password }); }} />

      <Modal open={Boolean(secret)} onClose={() => setSecret(null)} title={secret?.reset ? "Access reset" : "User created"}
        footer={<Button onClick={() => setSecret(null)}>Done</Button>}>
        {secret && (
          <div className="space-y-4 text-sm">
            <p className="text-slate-600">
              Give this temporary password to <span className="font-medium text-slate-900">{secret.email}</span>.
              They must choose a new password when they sign in.{secret.reset && " All their existing sessions have been signed out."}
            </p>
            <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3">
              <code className="text-base font-semibold tracking-wide text-slate-900">{secret.password}</code>
              <Button size="sm" variant="secondary" icon={Copy} onClick={() => navigator.clipboard?.writeText(secret.password)}>Copy</Button>
            </div>
            <Alert type="warning">This password is shown only once.</Alert>
          </div>
        )}
      </Modal>
    </>
  );
}

function UserForm({ user, companies, me, onClose, onSaved }) {
  const isNew = user && !user.id;
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (user) {
      setForm({ name: user.name ?? "", email: user.email ?? "", role: user.role ?? "analyst", company_id: user.company?.id ?? companies[0]?.id ?? "" });
      setError(null);
    }
  }, [user, companies]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = { name: form.name, role: form.role, company_id: form.role === "admin" ? null : form.company_id };
      const r = isNew
        ? await api.post("/api/admin/users", { ...body, email: form.email })
        : await api.patch(`/api/admin/users/${user.id}`, body);
      onSaved(r);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal open={Boolean(user)} onClose={onClose} title={isNew ? "Create user" : `Edit ${user?.name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>{isNew ? "Create user" : "Save changes"}</Button></>}>
      <div className="space-y-4">
        <Field label="Full name"><Input value={form.name ?? ""} onChange={set("name")} /></Field>
        <Field label="Email"><Input type="email" value={form.email ?? ""} onChange={set("email")} disabled={!isNew} /></Field>
        <Field label="Role" hint={ROLE_HELP[form.role]}>
          <Select value={form.role} onChange={set("role")} disabled={user?.id === me.id}>
            {["analyst", "viewer", "admin"].map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
          </Select>
        </Field>
        {form.role !== "admin" && (
          <Field label="Company">
            <Select value={form.company_id} onChange={set("company_id")}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}{!c.is_active ? " (inactive)" : ""}</option>)}
            </Select>
          </Field>
        )}
        {isNew && <p className="text-xs text-slate-500">A temporary password is generated. The user sets their own password at first sign-in.</p>}
        {!isNew && <p className="text-xs text-slate-500">Changing the role or company signs the user out of all sessions.</p>}
        {error && <Alert type="error">{error}</Alert>}
      </div>
    </Modal>
  );
}
