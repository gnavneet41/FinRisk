import { useCallback, useEffect, useState } from "react";
import { Globe, Lock, Plus, Search, Trash2, FileText, Eye, EyeOff } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth, isAdmin, canEdit } from "../lib/auth.jsx";
import {
  Alert, Button, Card, CardHeader, Drawer, EmptyState, Field, Input, Modal, PageHeader, Pill, Select, Spinner, Textarea, cx
} from "../components/ui.jsx";
import { date, titleCase } from "../lib/format.js";

export default function KnowledgeBase() {
  const { user } = useAuth();
  const admin = isAdmin(user);
  const companyEnabled = !admin && user.company?.subscription?.private_knowledge_enabled;

  return (
    <>
      <PageHeader
        title={admin ? "Global Knowledge" : "Knowledge Base"}
        description={admin
          ? "Reference knowledge used by every company's Risk Advisor and Ask FinRisk. Company knowledge is private to each company and is not visible to administrators."
          : "Knowledge the Risk Advisor and Ask FinRisk use to explain results. Global knowledge is shared by all companies; company knowledge is private to your company."}
      />
      <KnowledgeSearch />
      <div className="mt-6 space-y-8">
        <KnowledgeSection scope="global" editable={admin} />
        {!admin && (companyEnabled
          ? <KnowledgeSection scope="company" editable={canEdit(user)} />
          : <Alert type="info">Company knowledge is not included in your company's plan.</Alert>)}
      </div>
    </>
  );
}

function KnowledgeSection({ scope, editable }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState(null);
  const global = scope === "global";

  const load = useCallback(() => {
    api.get(`/api/knowledge/${scope}`).then(setData).catch((e) => setError(e.message));
  }, [scope]);
  useEffect(() => { load(); }, [load]);

  async function open(d) {
    const r = await api.get(`/api/knowledge/${scope}/${d.id}`);
    setViewing(r.document);
  }
  async function toggle(d) {
    await api.patch(`/api/knowledge/${scope}/${d.id}`, { is_active: !d.is_active });
    load();
  }
  async function remove(d) {
    await api.del(`/api/knowledge/${scope}/${d.id}`);
    setViewing(null);
    load();
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className={cx("grid size-8 place-items-center rounded-lg", global ? "bg-brand-50 text-brand-600" : "bg-violet-50 text-violet-600")}>
            {global ? <Globe className="size-4" /> : <Lock className="size-4" />}
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">{global ? "Global Knowledge" : "Company Knowledge"}</h2>
            <p className="text-xs text-slate-500">{global ? "Managed by the FinRisk administrator · shared by all companies" : "Private to your company · managed by your analysts"}</p>
          </div>
        </div>
        {editable && <Button icon={Plus} onClick={() => setAdding(true)}>Add document</Button>}
      </div>
      {error && <Alert type="error">{error}</Alert>}
      {!data ? <Spinner /> : data.documents.length === 0 ? (
        <Card>
          <EmptyState icon={FileText} title="No documents yet"
            description={global ? "Add accounting standards, ratio definitions or methodology notes." : "Add internal policies, company documents or internal financial information. Completed analyses are added here automatically as historical reports."}
            action={editable && <Button icon={Plus} onClick={() => setAdding(true)}>Add document</Button>} />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.documents.map((d) => (
            <button key={d.id} onClick={() => open(d)}
              className={cx("group flex flex-col rounded-xl border bg-white p-5 text-left shadow-sm transition hover:border-brand-300 hover:shadow-md",
                d.is_active ? "border-slate-200" : "border-dashed border-slate-300 opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <FileText className={cx("size-5 shrink-0", global ? "text-brand-500" : "text-violet-500")} />
                <Pill>{titleCase(d.category)}</Pill>
              </div>
              <p className="mt-3 font-semibold text-slate-900">{d.title}</p>
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">{d.description || d.source}</p>
              <p className="mt-auto pt-4 text-xs text-slate-400">
                {d.chunk_count} sections · {d.automatic ? "added automatically" : `added ${date(d.created_at)}`}{!d.is_active && " · inactive"}
              </p>
            </button>
          ))}
        </div>
      )}

      <AddKnowledge open={adding} scope={scope} categories={data?.categories ?? []} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />

      <Drawer open={Boolean(viewing)} onClose={() => setViewing(null)} title={viewing?.title} subtitle={viewing?.source} width="max-w-2xl">
        {viewing && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Pill>{titleCase(viewing.category)}</Pill>
              <Pill>{viewing.chunk_count} sections</Pill>
              {editable && (
                <div className="ml-auto flex gap-2">
                  {global && <Button size="sm" variant="secondary" icon={viewing.is_active ? EyeOff : Eye}
                    onClick={async () => { await toggle(viewing); setViewing({ ...viewing, is_active: !viewing.is_active }); }}>
                    {viewing.is_active ? "Deactivate" : "Activate"}
                  </Button>}
                  <Button size="sm" variant="danger" icon={Trash2} onClick={() => remove(viewing)}>Delete</Button>
                </div>
              )}
            </div>
            <p className="text-xs text-slate-500">Each section is retrieved separately and cited by its id.</p>
            {viewing.chunks.map((c) => (
              <div key={c.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-slate-900">{c.heading || viewing.title}</p>
                  <code className="text-[11px] text-slate-400">{c.id}</code>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{c.text}</p>
              </div>
            ))}
          </div>
        )}
      </Drawer>
    </section>
  );
}

function AddKnowledge({ open, scope, categories, onClose, onSaved }) {
  const [form, setForm] = useState({ title: "", category: "", source: "", description: "", content: "" });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) { setForm({ title: "", category: categories[0] ?? "", source: "", description: "", content: "" }); setFile(null); setError(null); }
  }, [open, categories]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (file) {
        const fd = new FormData();
        Object.entries(form).forEach(([k, v]) => k !== "content" && fd.append(k, v));
        fd.append("file", file);
        await api.upload(`/api/knowledge/${scope}`, fd);
      } else {
        await api.post(`/api/knowledge/${scope}`, form);
      }
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title={scope === "global" ? "Add global knowledge" : "Add company knowledge"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Add document</Button></>}>
      <div className="space-y-4">
        <Field label="Title"><Input value={form.title} onChange={set("title")} placeholder={scope === "global" ? "IAS 7 Statement of Cash Flows" : "Treasury policy 2026"} /></Field>
        <Field label="Category">
          <Select value={form.category} onChange={set("category")}>
            {categories.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
          </Select>
        </Field>
        <Field label="Source" hint="Where this comes from, so answers can cite it."><Input value={form.source} onChange={set("source")} /></Field>
        <Field label="Upload a file" hint=".md, .txt, .pdf or .docx, up to 10 MB. Or paste the text below.">
          <input type="file" accept=".md,.txt,.pdf,.docx" onChange={(e) => setFile(e.target.files[0] ?? null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200" />
        </Field>
        {!file && <Field label="Text"><Textarea rows={7} value={form.content} onChange={set("content")} placeholder="Use ## headings to split the text into sections." /></Field>}
        {error && <Alert type="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

function KnowledgeSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);

  async function search(e) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try {
      const r = await api.post("/api/knowledge/search", { query: q });
      setResults(r.results);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Test retrieval" subtitle="See which sections the Risk Advisor and Ask FinRisk would retrieve for a question." />
      <form onSubmit={search} className="flex gap-2 p-5 pb-4">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
          <Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. current liabilities classification" />
        </div>
        <Button type="submit" variant="secondary" loading={busy}>Search</Button>
      </form>
      {results && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {results.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">No matching sections.</li>}
          {results.map((r) => (
            <li key={r.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-slate-900">{r.title}</p>
                <span className={cx("rounded px-1.5 py-0.5 text-[11px] font-medium", r.scope === "company" ? "bg-violet-50 text-violet-700" : "bg-brand-50 text-brand-700")}>
                  {r.scope === "company" ? "Company" : "Global"}
                </span>
                <span className="text-xs text-slate-400">{r.document_title} · score {r.score}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-slate-600">{r.content}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
