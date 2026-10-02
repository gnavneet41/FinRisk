import { useEffect, useState } from "react";
import { Zap, RotateCcw, RefreshCw } from "lucide-react";
import { api } from "../../lib/api.js";
import { Alert, Button, Card, CardHeader, Field, Input, PageHeader, Select, Spinner, Tabs, Toggle } from "../../components/ui.jsx";
import { Monitoring } from "./AdminOverview.jsx";

const TABS = [
  { value: "processing", label: "Processing" },
  { value: "llm", label: "LLM" },
  { value: "rag", label: "RAG" },
  { value: "monitoring", label: "Monitoring" }
];
const FILE_TYPES = [["pdf", "PDF"], ["csv", "CSV"], ["xlsx", "Excel (.xlsx)"], ["docx", "Word (.docx)"]];

export default function AdminSystem() {
  const [tab, setTab] = useState("processing");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { api.get("/api/admin/system/config").then(setData).catch((e) => setError(e.message)); }, []);

  return (
    <>
      <PageHeader title="System" description="Platform-wide settings. Changes apply immediately to every company." />
      <Tabs tabs={TABS} value={tab} onChange={setTab} className="mb-6" />
      {error && <Alert type="error">{error}</Alert>}
      {tab === "monitoring" ? <Monitoring /> : !data ? <Spinner /> : (
        <ConfigSection key={tab} section={tab} data={data} onSaved={setData} />
      )}
    </>
  );
}

function ConfigSection({ section, data, onSaved }) {
  const [form, setForm] = useState(data.config[section]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const overridden = data.overridden?.[section] ?? [];
  const set = (k, v) => setForm({ ...form, [k]: v });

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const changed = Object.fromEntries(Object.entries(form).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(data.config[section][k])));
      const r = await api.put(`/api/admin/system/config/${section}`, changed);
      onSaved({ ...data, config: { ...data.config, [section]: r.config }, overridden: r.overridden, llm_status: r.llm_status });
      setMsg({ type: "success", text: "Settings saved and applied." });
    } catch (e) { setMsg({ type: "error", text: e.message }); } finally { setBusy(false); }
  }

  async function reset() {
    setBusy(true);
    try {
      const r = await api.del(`/api/admin/system/config/${section}`);
      setForm(r.config);
      onSaved({ ...data, config: { ...data.config, [section]: r.config }, overridden: r.overridden, llm_status: r.llm_status });
      setMsg({ type: "success", text: "Reset to the values from the server's .env file and defaults." });
    } catch (e) { setMsg({ type: "error", text: e.message }); } finally { setBusy(false); }
  }

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
      <p className="text-xs text-slate-500">
        {overridden.length ? `Changed by an administrator: ${overridden.join(", ")}. Other settings follow .env.` : "All settings follow the server's .env file and defaults."}
      </p>
      <div className="flex gap-2">
        {overridden.length > 0 && <Button variant="secondary" icon={RotateCcw} onClick={reset} disabled={busy}>Reset to .env</Button>}
        <Button onClick={save} loading={busy}>Save changes</Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {section === "llm" && <LlmStatus status={data.llm_status} />}
      <Card>
        {section === "processing" && <>
          <CardHeader title="Processing configuration" subtitle="How uploaded documents are handled" />
          <div className="grid gap-6 p-5 md:grid-cols-2">
            <Field label="Maximum file size (MB)" hint="1–100 MB.">
              <Input type="number" min={1} max={100} value={form.max_file_size_mb} onChange={(e) => set("max_file_size_mb", Number(e.target.value))} />
            </Field>
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">Allowed file types</p>
              <div className="flex flex-wrap gap-2">
                {FILE_TYPES.map(([t, label]) => {
                  const on = form.allowed_types.includes(t);
                  return (
                    <button key={t} type="button" onClick={() => set("allowed_types", on ? form.allowed_types.filter((x) => x !== t) : [...form.allowed_types, t])}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${on ? "bg-brand-50 text-brand-700 ring-brand-200" : "bg-white text-slate-500 ring-slate-200"}`}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <Toggle checked={form.auto_analyze} onChange={(v) => set("auto_analyze", v)} label="Analyse automatically after upload"
              description="When off, analysts start each analysis themselves after checking the values." />
            <Toggle checked={form.keep_uploaded_files} onChange={(v) => set("keep_uploaded_files", v)} label="Keep uploaded files"
              description="When off, the original file is deleted after the values are extracted." />
          </div>
        </>}

        {section === "llm" && <>
          <CardHeader title="LLM configuration" subtitle="API keys stay in the server's .env file and are never shown here." />
          <div className="grid gap-6 p-5 md:grid-cols-2">
            <Field label="Provider">
              <Select value={form.provider} onChange={(e) => set("provider", e.target.value)}>
                <option value="gemini">Google Gemini</option>
                <option value="openai_compatible">OpenAI-compatible (Groq, OpenRouter, Ollama…)</option>
                <option value="none">None (rule-based only)</option>
              </Select>
            </Field>
            {form.provider === "gemini" && <>
              <Field label="Model"><Input value={form.gemini_model} onChange={(e) => set("gemini_model", e.target.value)} /></Field>
              <Field label="Backup model" hint="Tried when the main model stays overloaded. Optional.">
                <Input value={form.gemini_fallback_model} onChange={(e) => set("gemini_fallback_model", e.target.value)} />
              </Field>
            </>}
            {form.provider === "openai_compatible" && <>
              <Field label="Base URL"><Input value={form.openai_base_url} onChange={(e) => set("openai_base_url", e.target.value)} placeholder="http://localhost:11434/v1" /></Field>
              <Field label="Model"><Input value={form.openai_model} onChange={(e) => set("openai_model", e.target.value)} /></Field>
            </>}
            <Field label="Maximum output tokens" hint="Raise if answers get cut off (1024–65536).">
              <Input type="number" value={form.max_output_tokens} onChange={(e) => set("max_output_tokens", Number(e.target.value))} />
            </Field>
            <Field label="Timeout (seconds)"><Input type="number" value={form.timeout_seconds} onChange={(e) => set("timeout_seconds", Number(e.target.value))} /></Field>
            <Toggle checked={form.fallback_enabled} onChange={(v) => set("fallback_enabled", v)} label="Rule-based fallback"
              description="If the LLM fails, agents use documented rules so analyses still complete." />
          </div>
        </>}

        {section === "rag" && <>
          <CardHeader title="RAG system configuration" subtitle="How knowledge is retrieved for the Risk Advisor and Ask FinRisk"
            action={<Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => api.post("/api/admin/system/rag/rebuild").then(() => setMsg({ type: "success", text: "The retrieval index will be rebuilt on the next request." }))}>Rebuild index</Button>} />
          <div className="grid gap-6 p-5 md:grid-cols-2">
            <Field label="Interpretation rules per assessment" hint="Curated rules matched to the calculated ratios (1–50).">
              <Input type="number" value={form.max_rule_entries} onChange={(e) => set("max_rule_entries", Number(e.target.value))} />
            </Field>
            <Field label="Document sections per assessment" hint="Extra text sections found by search (0–20).">
              <Input type="number" value={form.max_document_chunks} onChange={(e) => set("max_document_chunks", Number(e.target.value))} />
            </Field>
            <Field label="Sections per chat question" hint="1–20.">
              <Input type="number" value={form.chat_top_k} onChange={(e) => set("chat_top_k", Number(e.target.value))} />
            </Field>
            <Field label="Section size for new documents (characters)" hint="200–5000. Applies to documents added after the change.">
              <Input type="number" value={form.chunk_size_chars} onChange={(e) => set("chunk_size_chars", Number(e.target.value))} />
            </Field>
            <Toggle checked={form.include_company_knowledge} onChange={(v) => set("include_company_knowledge", v)} label="Use company knowledge"
              description="Include each company's private knowledge in its own retrieval. Never shared across companies." />
          </div>
        </>}
        {msg && <div className="px-5 pb-2"><Alert type={msg.type}>{msg.text}</Alert></div>}
        {footer}
      </Card>
    </div>
  );
}

function LlmStatus({ status }) {
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try { setTest(await api.post("/api/admin/system/llm/test")); } finally { setBusy(false); }
  }
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="text-sm">
          <p className="font-medium text-slate-900">
            {status.configured ? `Connected to ${status.provider} (${status.models.join(", ")})` : "No language model configured"}
          </p>
          <p className="mt-0.5 text-slate-500">API key in .env: {status.api_key_present ? "present" : "missing"} · Fallback {status.fallback_enabled ? "on" : "off"}</p>
        </div>
        <Button variant="secondary" icon={Zap} onClick={run} loading={busy} disabled={!status.configured}>Test connection</Button>
      </div>
      {test && (
        <div className="px-5 pb-5">
          <Alert type={test.ok ? "success" : "error"}>
            {test.ok ? `The model answered in ${(test.latency_ms / 1000).toFixed(1)}s.` : `Test failed: ${test.error}`}
          </Alert>
        </div>
      )}
    </Card>
  );
}
