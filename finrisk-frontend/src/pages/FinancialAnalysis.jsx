import { useState } from "react";
import { ChevronRight, Calculator, AlertTriangle } from "lucide-react";
import { useAnalysis } from "../lib/analysis.jsx";
import { useAuth, canEdit } from "../lib/auth.jsx";
import { Alert, Card, CardHeader, Drawer, PageHeader, RiskBadge, Spinner, Tabs, cx } from "../components/ui.jsx";
import { RatioBars } from "../components/charts.jsx";
import { NoAnalysis } from "./Dashboard.jsx";
import { CATEGORIES, RATIO_INFO, dataValue, labelFor, methodLabel, number, ratioValue } from "../lib/format.js";

const TABS = [{ value: "overview", label: "Overview" }, ...CATEGORIES.map((c) => ({ value: c.key, label: c.name }))];

export default function FinancialAnalysis() {
  const { document: doc, loading, completed, error } = useAnalysis();
  const { user } = useAuth();
  const [tab, setTab] = useState("overview");
  const [selected, setSelected] = useState(null);

  if (loading) return <Spinner />;
  if (error) return <Alert type="error">{error}</Alert>;
  if (!completed.length || !doc) return <NoAnalysis canUpload={canEdit(user)} />;

  const ratios = Object.entries(doc.analysis.calculated_ratios).map(([key, r]) => ({ key, ...r }));
  const riskByCategory = Object.fromEntries(doc.risk_assessment.category_assessments.map((c) => [c.category, c]));
  const category = CATEGORIES.find((c) => c.key === tab);

  return (
    <>
      <PageHeader
        title="Financial Analysis"
        description={`${doc.company_name ?? ""} ${doc.fiscal_year ?? ""} — ${ratios.length} ratios calculated by the Calculation Engine from the extracted values. Click a ratio for its inputs.`}
      />
      <Tabs tabs={TABS} value={tab} onChange={setTab} className="mb-6" />

      {tab === "overview" ? (
        <Overview doc={doc} ratios={ratios} riskByCategory={riskByCategory} onSelect={setSelected} onOpenTab={setTab} />
      ) : (
        <CategoryTab category={category} ratios={ratios.filter((r) => r.category === category.analysis)}
          assessment={riskByCategory[category.risk]} doc={doc} onSelect={setSelected} />
      )}

      <RatioDrawer ratio={selected} doc={doc} onClose={() => setSelected(null)} />
    </>
  );
}

function Overview({ doc, ratios, riskByCategory, onSelect, onOpenTab }) {
  const plan = doc.analysis_plan;
  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm text-slate-500">Ratios calculated</p>
          <p className="mt-1 text-2xl font-semibold tabular">{ratios.length}</p>
          <p className="mt-1 text-xs text-slate-500">{doc.analysis.unavailable_calculations.length} not possible (missing values)</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-slate-500">Analysis categories</p>
          <p className="mt-1 text-2xl font-semibold tabular">{doc.analysis.analysis_categories.length}</p>
          <p className="mt-1 text-xs text-slate-500">Selected by {methodLabel(plan.generated_by)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-slate-500">Observations</p>
          <p className="mt-1 text-2xl font-semibold tabular">{doc.analysis.observations.length}</p>
          <p className="mt-1 text-xs text-slate-500">Facts noted by the Analysis Agent</p>
        </Card>
      </div>

      {CATEGORIES.map((cat) => {
        const rows = ratios.filter((r) => r.category === cat.analysis);
        if (!rows.length) return null;
        return (
          <section key={cat.key}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-base font-semibold text-slate-900">{cat.name}</h2>
                {riskByCategory[cat.risk] && <RiskBadge level={riskByCategory[cat.risk].level} />}
              </div>
              <button onClick={() => onOpenTab(cat.key)} className="flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
                Details <ChevronRight className="size-4" />
              </button>
            </div>
            <RatioGrid rows={rows} onSelect={onSelect} />
          </section>
        );
      })}

      <Unavailable doc={doc} />

      {doc.analysis.observations.length > 0 && (
        <Card>
          <CardHeader title="Analysis Agent observations" subtitle="Factual notes on the extracted values. Values are checked against the document." />
          <ul className="divide-y divide-slate-100">
            {doc.analysis.observations.map((o) => (
              <li key={o.key + o.reason} className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-[14rem_9rem_1fr] sm:gap-4">
                <span className="font-medium text-slate-900">{labelFor(o.key)}</span>
                <span className="tabular text-slate-700 sm:text-right">{dataValue(o.key, Number(o.value))}</span>
                <span className="text-slate-600">{o.reason}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function CategoryTab({ category, ratios, assessment, doc, onSelect }) {
  const factors = doc.risk_assessment.risk_factors.filter((f) => f.category === category.risk);
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title={category.name} subtitle={category.question}
            action={assessment ? <RiskBadge level={assessment.level} /> : <span className="text-xs text-slate-500">Not rated</span>} />
          <div className="px-3 pt-3">
            {ratios.length
              ? <RatioBars rows={ratios.map((r) => ({ label: r.name, value: r.value, unit: r.unit }))}
                  reference={["liquidity", "solvency"].includes(category.key) ? { value: 1, label: "1.0" } : null} />
              : <p className="px-2 py-6 text-sm text-slate-500">No ratios in this category could be calculated.</p>}
          </div>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="What this means" />
          <div className="space-y-4 p-5 text-sm leading-relaxed text-slate-600">
            <p>{assessment?.summary ?? "This category is not rated because rating it needs industry benchmarks, which are not available."}</p>
            {factors.map((f) => (
              <div key={f.id} className="rounded-lg bg-slate-50 p-3">
                <p className="font-medium text-slate-900">{f.title}</p>
                <p className="mt-1">{f.interpretation}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <RatioGrid rows={ratios} onSelect={onSelect} />
      {category.key === "solvency" && <Unavailable doc={doc} only="solvency_analysis" />}
    </div>
  );
}

function RatioGrid({ rows, onSelect }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((r) => (
        <button
          key={r.key}
          onClick={() => onSelect(r)}
          className="group rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm shadow-slate-900/[0.03] transition hover:border-brand-300 hover:shadow-md"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-slate-600">{r.name}</p>
            <ChevronRight className="size-4 text-slate-300 transition group-hover:text-brand-500" />
          </div>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 tabular">{ratioValue(r.value, r.unit)}</p>
          <p className="mt-3 truncate rounded-md bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-500" title={r.formula}>{r.formula}</p>
          <p className="mt-3 line-clamp-2 text-sm text-slate-500">{RATIO_INFO[r.key]}</p>
        </button>
      ))}
    </div>
  );
}

function Unavailable({ doc, only }) {
  const items = doc.analysis.unavailable_calculations.filter((u) => !only || u.calculation === "interest_coverage");
  if (!items.length) return null;
  return (
    <Alert type="warning" title="Not calculated">
      {items.map((u) => (
        <p key={u.calculation}>
          {u.name ?? labelFor(u.calculation)}: {u.missing_keys.length ? `missing ${u.missing_keys.map(labelFor).join(", ")}` : u.reason}.
          FinRisk does not estimate missing values.
        </p>
      ))}
    </Alert>
  );
}

function RatioDrawer({ ratio, doc, onClose }) {
  if (!ratio) return null;
  const factors = doc.risk_assessment.risk_factors.filter((f) => f.evidence.some((e) => e.key === ratio.key));
  const knowledge = Object.fromEntries((doc.risk_assessment.retrieved_knowledge ?? []).map((k) => [k.id, k]));
  const refs = [...new Set(factors.flatMap((f) => f.knowledge_refs))].map((id) => knowledge[id]).filter(Boolean);
  const category = CATEGORIES.find((c) => c.analysis === ratio.category);

  return (
    <Drawer open onClose={onClose} title={ratio.name} subtitle={category?.name}>
      <div className="space-y-6">
        <div>
          <p className="text-4xl font-semibold tracking-tight tabular text-slate-900">{ratioValue(ratio.value, ratio.unit)}</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{RATIO_INFO[ratio.key]}</p>
        </div>

        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900"><Calculator className="size-4 text-slate-400" /> Formula</h3>
          <p className="rounded-lg bg-slate-50 px-3 py-2.5 font-mono text-xs text-slate-700">{ratio.formula}</p>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Input values</h3>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {Object.entries(ratio.inputs ?? {}).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-3 py-2 text-sm">
                <span className="text-slate-600">{labelFor(k)}</span>
                <span className="font-medium tabular text-slate-900">{dataValue(k, v)}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            From {doc.filename}{doc.corrected_fields?.some((c) => Object.hasOwn(ratio.inputs ?? {}, c.key)) ? " (includes a manually corrected value)" : ""}.
            Calculated as {Object.entries(ratio.inputs ?? {}).map(([k, v]) => `${k} = ${number(v)}`).join(", ")}.
          </p>
        </section>

        {factors.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Used as evidence in the risk assessment</h3>
            <div className="space-y-3">
              {factors.map((f) => (
                <div key={f.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900">{f.title}</p>
                    <RiskBadge level={f.level} />
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{f.interpretation}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {refs.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Knowledge sources</h3>
            <ul className="space-y-1.5 text-sm">
              {refs.map((k) => (
                <li key={k.id} className="flex gap-2 text-slate-600">
                  <span className={cx("mt-1.5 size-1.5 shrink-0 rounded-full", k.scope === "company" ? "bg-violet-500" : "bg-brand-500")} />
                  <span><span className="font-medium text-slate-800">{k.title}</span> — {k.document_title ?? k.source}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {ratio.key === "return_on_equity" && ratio.value > 100 && (
          <Alert type="info" title="Why this is so high">
            A small equity base (for example after large share buybacks) makes ROE very large. Read it alongside return on assets.
          </Alert>
        )}
        {(ratio.unit === "times" || ratio.key.startsWith("return_")) && (
          <p className="flex gap-2 text-xs text-slate-500">
            <AlertTriangle className="size-3.5 shrink-0" />
            Uses period-end balances. Average balances would need the prior-year figures.
          </p>
        )}
      </div>
    </Drawer>
  );
}
