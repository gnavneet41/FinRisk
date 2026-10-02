import { Lightbulb, BookOpen, ListChecks, Info, ShieldCheck } from "lucide-react";
import { useAnalysis } from "../lib/analysis.jsx";
import { useAuth, canEdit } from "../lib/auth.jsx";
import { Alert, Card, CardHeader, PageHeader, RiskBadge, Spinner, cx } from "../components/ui.jsx";
import { NoAnalysis } from "./Dashboard.jsx";
import { CATEGORIES, RISK_LEVELS, RISK_STYLE, dataValue, date, labelFor, methodLabel, ratioValue } from "../lib/format.js";

export default function RiskAssessment() {
  const { document: doc, loading, completed, error } = useAnalysis();
  const { user } = useAuth();

  if (loading) return <Spinner />;
  if (error) return <Alert type="error">{error}</Alert>;
  if (!completed.length || !doc) return <NoAnalysis canUpload={canEdit(user)} />;

  const risk = doc.risk_assessment;
  const overall = risk.overall_assessment;
  const knowledge = Object.fromEntries((risk.retrieved_knowledge ?? []).map((k) => [k.id, k]));
  const ratios = doc.analysis.calculated_ratios;
  const fallback = risk.generated_by?.method === "rule_based";

  return (
    <>
      <PageHeader
        title="Risk Assessment"
        description={`${doc.company_name ?? ""} ${doc.fiscal_year ?? ""} — interpreted by the Risk Advisor from the calculated ratios and the knowledge base.`}
      />

      {/* Overall */}
      <Card className="mb-6">
        <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div>
            <p className="text-sm font-medium text-slate-500">Overall risk level</p>
            <p className={cx("mt-1 text-5xl font-semibold tracking-tight", RISK_STYLE[overall.level].text)}>
              {RISK_STYLE[overall.level].label}
            </p>
            <RiskScale level={overall.level} />
            <p className="mt-5 max-w-3xl text-[15px] leading-relaxed text-slate-700">{overall.summary}</p>
          </div>
          <dl className="h-fit space-y-3 rounded-lg bg-slate-50 p-4 text-sm">
            <Meta label="Risk Advisor" value={methodLabel(risk.generated_by)} />
            <Meta label="Analysis plan" value={methodLabel(doc.analysis_plan.generated_by)} />
            <Meta label="Ratios" value="Calculation Engine (code)" />
            <Meta label="Knowledge sources" value={`${risk.retrieved_knowledge?.length ?? 0} retrieved`} />
            <Meta label="Analysed" value={date(doc.analyzed_at)} />
          </dl>
        </div>
      </Card>

      {fallback && (
        <Alert type="warning" className="mb-6" title="Rule-based assessment">
          The language model was unavailable, so this assessment uses FinRisk's documented rules. Re-run the analysis from Documents for the full interpretation.
        </Alert>
      )}

      {/* Sections */}
      <div className="space-y-5">
        {CATEGORIES.map((cat) => {
          const assessment = risk.category_assessments.find((c) => c.category === cat.risk);
          const factors = risk.risk_factors.filter((f) => f.category === cat.risk);
          const catRatios = Object.values(ratios).filter((r) => r.category === cat.analysis);
          if (!assessment && !factors.length && !catRatios.length) return null;

          const evidence = factors.length
            ? dedupe(factors.flatMap((f) => f.evidence))
            : catRatios.map((r) => ({ type: "ratio", key: r.name, name: r.name, value: r.value, unit: r.unit }));
          const refs = [...new Set(factors.flatMap((f) => f.knowledge_refs))].map((id) => knowledge[id]).filter(Boolean);
          const level = assessment?.level ?? factors[0]?.level;

          return (
            <Card key={cat.key} className="overflow-hidden">
              <div className={cx("h-1", level ? RISK_STYLE[level].bar : "bg-slate-200")} />
              <CardHeader
                title={cat.name}
                subtitle={cat.question}
                action={level ? <RiskBadge level={level} /> : <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">Not rated</span>}
              />
              <div className="grid gap-6 p-5 lg:grid-cols-3">
                <Section icon={Lightbulb} title="Key observation">
                  {factors.length
                    ? factors.map((f) => <p key={f.id} className="font-medium text-slate-900">{f.title}</p>)
                    : <p className="text-slate-600">{assessment?.summary ?? "Reported, but not rated: rating requires industry benchmarks that are not available."}</p>}
                </Section>

                <Section icon={ListChecks} title="Supporting metrics">
                  <ul className="space-y-1.5">
                    {evidence.slice(0, 5).map((e) => (
                      <li key={e.type + e.key} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-slate-600">{e.name ?? labelFor(e.key)}</span>
                        <span className="font-semibold tabular text-slate-900">
                          {e.type === "ratio" ? ratioValue(e.value, e.unit) : dataValue(e.key, e.value)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Section>

                <Section icon={Info} title="Explanation">
                  <p className="text-sm leading-relaxed text-slate-600">
                    {factors[0]?.interpretation ?? assessment?.summary ??
                      "Turnover ratios are shown for information. Whether they are high or low depends on the industry."}
                  </p>
                </Section>
              </div>
              {refs.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-xs">
                  <BookOpen className="size-3.5 text-slate-400" />
                  <span className="text-slate-500">Knowledge used:</span>
                  {refs.map((k) => (
                    <span key={k.id} title={k.document_title ?? k.source}
                      className={cx("rounded-md px-2 py-0.5 font-medium ring-1 ring-inset",
                        k.scope === "company" ? "bg-violet-50 text-violet-700 ring-violet-200" : "bg-white text-slate-700 ring-slate-200")}>
                      {k.title}
                    </span>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Recommendations + limitations */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recommendations" />
          <ol className="space-y-3 p-5">
            {risk.recommendations.map((r, i) => (
              <li key={r.text} className="flex gap-3 text-sm text-slate-700">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{i + 1}</span>
                <span className="pt-0.5">{r.text}</span>
              </li>
            ))}
          </ol>
        </Card>
        <Card>
          <CardHeader title="Limitations" subtitle="What this assessment cannot tell you" />
          <ul className="space-y-2 p-5 text-sm text-slate-600">
            {risk.limitations.map((l) => <li key={l} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-slate-400" />{l}</li>)}
            {risk.benchmarks_unavailable?.length > 0 && (
              <li className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-slate-400" />Benchmarks not available: {risk.benchmarks_unavailable.join("; ")}.</li>
            )}
          </ul>
        </Card>
      </div>

      {risk.validation_notes?.length > 0 && (
        <Alert type="info" className="mt-6" title="Checks on the AI output">
          <ul className="list-disc pl-4">{risk.validation_notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </Alert>
      )}

      <Card className="mt-6">
        <CardHeader title="Knowledge sources" subtitle="Retrieved from the global knowledge base and your company's private knowledge" />
        <ul className="grid gap-x-6 gap-y-2 p-5 text-sm sm:grid-cols-2">
          {(risk.retrieved_knowledge ?? []).map((k) => (
            <li key={k.id} className="flex gap-2">
              <ShieldCheck className={cx("mt-0.5 size-4 shrink-0", k.scope === "company" ? "text-violet-500" : "text-brand-500")} />
              <span className="min-w-0">
                <span className="font-medium text-slate-800">{k.title}</span>
                <span className="block truncate text-xs text-slate-500">{k.scope === "company" ? "Company knowledge" : "Global"} · {k.document_title ?? k.source}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function RiskScale({ level }) {
  const idx = RISK_LEVELS.indexOf(level);
  return (
    <div className="mt-5 max-w-lg">
      <div className="grid grid-cols-4 gap-1">
        {RISK_LEVELS.map((l, i) => (
          <div key={l} className={cx("h-2 rounded-full", i <= idx ? RISK_STYLE[l].bar : "bg-slate-200", i < idx && "opacity-40")} />
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-4 gap-1 text-xs">
        {RISK_LEVELS.map((l, i) => (
          <span key={l} className={i === idx ? "font-semibold text-slate-900" : "text-slate-400"}>{RISK_STYLE[l].label}</span>
        ))}
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, children }) {
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-500">
        <Icon className="size-3.5" /> {title}
      </h3>
      <div className="space-y-1.5 text-sm">{children}</div>
    </div>
  );
}

function Meta({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-800">{value}</dd>
    </div>
  );
}

function dedupe(evidence) {
  const seen = new Set();
  return evidence.filter((e) => (seen.has(e.key) ? false : seen.add(e.key)));
}
