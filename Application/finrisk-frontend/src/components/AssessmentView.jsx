import {
  RISK_LEVELS,
  CATEGORY_NAMES,
  capitalize,
  formatNumber,
  formatRatio,
  labelFor,
  methodLabel
} from "../format.js";

const RATIO_GROUPS = [
  "liquidity_analysis",
  "solvency_analysis",
  "profitability_analysis",
  "efficiency_analysis",
  "cash_flow_analysis"
];

export default function AssessmentView({ report, onEditValues }) {
  const { analysis, analysis_plan: plan, risk_assessment: risk } = report;
  const overall = risk.overall_assessment;
  const usedFallback = plan?.generated_by?.method === "rule_based" || risk.generated_by?.method === "rule_based";

  return (
    <section className="assessment">
      {/* ---------- Hero: the conclusion first ---------- */}
      <div className="verdict">
        <div className="verdict-text">
          <p className="verdict-label">Overall risk for {analysis.company ?? "this company"}, {analysis.fiscal_year ?? ""}</p>
          <h1 className={`verdict-level text-${overall.level}`}>{capitalize(overall.level)}</h1>
          <RiskScale level={overall.level} />
          <p className="verdict-summary">{overall.summary}</p>
        </div>
        <div className="verdict-actions">
          {report.pdf_url ? (
            <a className="btn btn-primary" href={report.pdf_url} download>Download PDF report</a>
          ) : (
            <p className="muted">PDF not available{report.pdf_error ? `: ${report.pdf_error}` : ""}</p>
          )}
          <button className="btn" onClick={onEditValues}>Edit values and re-run</button>
          <dl className="provenance">
            <dt>Analysis plan</dt><dd>{methodLabel(plan?.generated_by)}</dd>
            <dt>Risk assessment</dt><dd>{methodLabel(risk.generated_by)}</dd>
            <dt>Ratios</dt><dd>Calculation Engine (code)</dd>
          </dl>
        </div>
      </div>

      {usedFallback && (
        <p className="alert alert-warn">
          The LLM was unavailable, so part of this assessment comes from the rule-based fallback.
          Re-run the analysis later for the full LLM interpretation.
          {risk.generated_by?.llm_error && <span className="detail"> Reason: {risk.generated_by.llm_error}</span>}
        </p>
      )}

      {report.corrected_fields?.length > 0 && (
        <p className="alert alert-info">
          Analysed with {report.corrected_fields.length} manually corrected value
          {report.corrected_fields.length > 1 ? "s" : ""}:{" "}
          {report.corrected_fields.map((c) => labelFor(c.key)).join(", ")}.
        </p>
      )}

      {/* ---------- Categories ---------- */}
      <h2>Risk by category</h2>
      <div className="categories">
        {risk.category_assessments.map((c) => (
          <div key={c.category} className="category">
            <div className="category-head">
              <h3>{CATEGORY_NAMES[c.category]}</h3>
              <span className={`level level-${c.level}`}>{capitalize(c.level)}</span>
            </div>
            <p>{c.summary}</p>
          </div>
        ))}
      </div>

      {/* ---------- Risk factors ---------- */}
      <h2>Risk factors and evidence</h2>
      <ol className="factors">
        {risk.risk_factors.map((f) => (
          <li key={f.id} className={`factor border-${f.level}`}>
            <div className="factor-head">
              <h3><span className="factor-id">{f.id}</span> {f.title}</h3>
              <span className={`level level-${f.level}`}>{capitalize(f.level)}</span>
            </div>
            <p className="factor-cat">{CATEGORY_NAMES[f.category]}</p>
            {f.interpretation && <p>{f.interpretation}</p>}
            <ul className="evidence" aria-label="Evidence">
              {f.evidence.map((e) => (
                <li key={e.type + e.key}>
                  <span>{e.name ?? labelFor(e.key)}</span>
                  <strong className="num">{e.type === "ratio" ? formatRatio(e.value, e.unit) : formatNumber(e.value)}</strong>
                </li>
              ))}
            </ul>
            {f.knowledge_refs?.length > 0 && (
              <p className="refs">Knowledge: {f.knowledge_refs.join(", ")}</p>
            )}
          </li>
        ))}
      </ol>

      {/* ---------- Recommendations ---------- */}
      {risk.recommendations?.length > 0 && (
        <>
          <h2>Recommendations</h2>
          <ul className="recommendations">
            {risk.recommendations.map((r) => (
              <li key={r.text}>
                {r.text}
                {r.related_risk_factors?.length > 0 && <span className="refs"> ({r.related_risk_factors.join(", ")})</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* ---------- Ratios ---------- */}
      <h2>Financial ratios</h2>
      <p className="section-note">Calculated by the Calculation Engine from the extracted values. The LLM never does the arithmetic.</p>
      <div className="ratio-groups">
        {RATIO_GROUPS.map((group) => {
          const rows = Object.entries(analysis.calculated_ratios).filter(([, r]) => r.category === group);
          if (!rows.length) return null;
          return (
            <table key={group} className="table ratios">
              <caption>{CATEGORY_NAMES[group]}</caption>
              <tbody>
                {rows.map(([key, r]) => (
                  <tr key={key}>
                    <th scope="row">{r.name}</th>
                    <td className="num value">{formatRatio(r.value, r.unit)}</td>
                    <td className="formula">{r.formula}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        })}
      </div>
      {analysis.unavailable_calculations?.length > 0 && (
        <div className="unavailable">
          <p><strong>Not calculated</strong> (required values missing, never estimated):</p>
          <ul>
            {analysis.unavailable_calculations.map((u) => (
              <li key={u.calculation}>
                {u.name ?? labelFor(u.calculation)}: missing {u.missing_keys.map(labelFor).join(", ") || u.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---------- Observations ---------- */}
      {analysis.observations?.length > 0 && (
        <>
          <h2>Analysis Agent observations</h2>
          <ul className="observations">
            {analysis.observations.map((o) => (
              <li key={o.key + o.reason}>
                <span className="obs-key">{labelFor(o.key)}</span>
                <span className="num obs-value">{formatNumber(o.value)}</span>
                <span>{o.reason}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* ---------- Limitations and sources ---------- */}
      <h2>Limitations</h2>
      <ul className="limitations">
        {risk.limitations.map((l) => <li key={l}>{l}</li>)}
        {risk.benchmarks_unavailable?.length > 0 && (
          <li>Benchmarks not available: {risk.benchmarks_unavailable.join("; ")}.</li>
        )}
      </ul>

      {risk.validation_notes?.length > 0 && (
        <div className="alert alert-warn">
          <p><strong>Validation notes</strong> (checks on the LLM output)</p>
          <ul>{risk.validation_notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      )}

      <details className="sources">
        <summary>Knowledge used by the Risk Advisor ({risk.retrieved_knowledge?.length ?? 0} entries)</summary>
        <ul>
          {risk.retrieved_knowledge?.map((k) => (
            <li key={k.id}><strong>{k.id}</strong> {k.title} <span className="muted">({k.source})</span></li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function RiskScale({ level }) {
  const index = RISK_LEVELS.indexOf(level);
  return (
    <div className="scale" role="img" aria-label={`Risk level ${level}, ${index + 1} of ${RISK_LEVELS.length}`}>
      {RISK_LEVELS.map((l, i) => (
        <div key={l} className={`scale-step scale-${l} ${i === index ? "is-active" : ""} ${i < index ? "is-below" : ""}`}>
          <span>{capitalize(l)}</span>
        </div>
      ))}
    </div>
  );
}
