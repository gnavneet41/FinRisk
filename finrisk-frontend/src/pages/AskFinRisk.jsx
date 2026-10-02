import { useEffect, useRef, useState } from "react";
import { Send, BookOpen, FileText, BarChart3, Sparkles } from "lucide-react";
import { api } from "../lib/api.js";
import { useAnalysis } from "../lib/analysis.jsx";
import { useAuth, canEdit } from "../lib/auth.jsx";
import { Alert, Card, CardHeader, PageHeader, RiskBadge, Spinner, cx } from "../components/ui.jsx";
import { NoAnalysis } from "./Dashboard.jsx";
import { ratioValue, money } from "../lib/format.js";

const SUGGESTIONS = [
  "Why is the current ratio below 1?",
  "Explain the company's debt position.",
  "What are the main financial observations?",
  "Explain the profitability analysis."
];

export default function AskFinRisk() {
  const { document: doc, loading, completed } = useAnalysis();
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);

  // New conversation when the selected analysis changes.
  useEffect(() => { setMessages([]); }, [doc?.id]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  if (loading) return <Spinner />;
  if (!completed.length || !doc) return <NoAnalysis canUpload={canEdit(user)} />;
  if (user.company?.subscription && !user.company.subscription.chat_enabled) {
    return (
      <>
        <PageHeader title="Ask FinRisk" />
        <Alert type="info">Ask FinRisk is not included in your company's plan. Contact your administrator.</Alert>
      </>
    );
  }

  async function send(question) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: "user", content: q }]);
    setBusy(true);
    try {
      const r = await api.post("/api/chat", { question: q, document_id: doc.id, history });
      setMessages((m) => [...m, { role: "assistant", content: r.answer, sources: r.sources, context: r.context, method: r.generated_by }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: e.message, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  const lastAnswer = [...messages].reverse().find((m) => m.role === "assistant" && !m.error);
  const r = doc.analysis.calculated_ratios;

  return (
    <>
      <PageHeader
        title="Ask FinRisk"
        description="Ask questions about this analysis. Answers use the calculated results, the global knowledge base and your company's private knowledge, and list their sources."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="flex h-[calc(100vh-15rem)] min-h-[520px] flex-col">
          <div ref={listRef} className="flex-1 space-y-6 overflow-y-auto p-5 sm:p-6" aria-live="polite">
            {messages.length === 0 && (
              <div className="mx-auto max-w-xl py-6 text-center">
                <div className="mx-auto grid size-11 place-items-center rounded-full bg-brand-50 text-brand-600"><Sparkles className="size-5" /></div>
                <h2 className="mt-4 text-base font-semibold text-slate-900">
                  Analyst assistant for {doc.company_name} {doc.fiscal_year}
                </h2>
                <p className="mt-1 text-sm text-slate-500">Start with one of these questions or write your own.</p>
                <div className="mt-6 grid gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)}
                      className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-700 transition hover:border-brand-300 hover:bg-brand-50/40">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[80%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-sm text-white">{m.content}</p>
              </div>
            ) : (
              <div key={i} className="flex gap-3">
                <div className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">F</div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-500">FinRisk analyst</p>
                  <div className={cx("mt-1 whitespace-pre-wrap text-sm leading-relaxed", m.error ? "text-red-700" : "text-slate-800")}>{m.content}</div>
                  {m.sources?.length > 0 && <Sources sources={m.sources} context={m.context} />}
                  {m.method?.method === "rule_based" && (
                    <p className="mt-2 text-xs text-amber-700">The language model was unavailable; this answer lists the most relevant retrieved facts.</p>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex gap-3">
                <div className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">F</div>
                <div className="flex items-center gap-1.5 pt-2">
                  {[0, 1, 2].map((d) => <span key={d} className="size-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${d * 120}ms` }} />)}
                </div>
              </div>
            )}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2 border-t border-slate-200 p-3 sm:p-4">
            <label htmlFor="ask" className="sr-only">Your question</label>
            <input id="ask" value={input} onChange={(e) => setInput(e.target.value)} maxLength={1000} disabled={busy}
              placeholder="Ask about a ratio, a risk factor or the methodology"
              className="min-w-0 flex-1 rounded-lg border-0 px-3 py-2.5 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500 focus:outline-none" />
            <button disabled={busy || !input.trim()} aria-label="Send"
              className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-600 text-white transition hover:bg-brand-700 disabled:opacity-40">
              <Send className="size-4" />
            </button>
          </form>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Context" subtitle={doc.filename} />
            <div className="space-y-3 p-5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Overall risk</span>
                <RiskBadge level={doc.overall_risk_level} />
              </div>
              {[
                ["Revenue", money(doc.financial_data.revenue)],
                ["Current ratio", ratioValue(r.current_ratio?.value)],
                ["Debt-to-equity", ratioValue(r.debt_to_equity?.value)],
                ["Net profit margin", ratioValue(r.net_profit_margin?.value, "percent")]
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <span className="text-slate-500">{k}</span>
                  <span className="font-medium tabular text-slate-900">{v}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="Knowledge searched" subtitle="For the latest answer" />
            <div className="p-5">
              {lastAnswer?.context?.knowledge?.length ? (
                <ul className="space-y-2.5 text-sm">
                  {lastAnswer.context.knowledge.map((k) => (
                    <li key={k.id} className="flex gap-2">
                      <BookOpen className={cx("mt-0.5 size-4 shrink-0", k.scope === "company" ? "text-violet-500" : "text-brand-500")} />
                      <span className="min-w-0">
                        <span className="block font-medium text-slate-800">{k.title}</span>
                        <span className="block truncate text-xs text-slate-500">{k.scope === "company" ? "Company" : "Global"} · {k.document_title}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-slate-500">Ask a question to see which knowledge was used.</p>}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Sources({ sources, context }) {
  const known = Object.fromEntries((context?.knowledge ?? []).map((k) => [k.id, k]));
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {sources.map((s) => {
        const k = known[s];
        const isReport = s.includes(":");
        const Icon = k ? BookOpen : isReport && s.startsWith("ratio:") ? BarChart3 : FileText;
        const label = k ? k.title : isReport ? s.split(":")[1].replace(/_/g, " ") : s;
        return (
          <span key={s} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            <Icon className="size-3" /> {label}
          </span>
        );
      })}
    </div>
  );
}
