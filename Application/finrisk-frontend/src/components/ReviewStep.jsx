import { useMemo, useState } from "react";
import { analyzeReport } from "../api.js";
import { FIELD_GROUPS, formatNumber } from "../format.js";

const PIPELINE = [
  "Analysis Agent chooses what to analyse",
  "Calculation Engine computes the ratios",
  "Risk Advisor retrieves knowledge and assesses risk",
  "Report Generator builds the PDF"
];

const TEXT_FIELDS = new Set(["company", "fiscal_year"]);

export default function ReviewStep({ report, onAnalyzed, onReportChange }) {
  const extracted = report.extracted_data ?? report.financial_data;
  const [values, setValues] = useState(() => toInputs(report.financial_data));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const validation = report.validation;
  const missingCount = Object.entries(extracted).filter(([, v]) => v === null).length;

  // Only send values that differ from what the Document Agent extracted.
  const corrections = useMemo(() => {
    const out = {};
    for (const [key, input] of Object.entries(values)) {
      if (input !== toInput(extracted[key])) out[key] = input === "" ? null : input;
    }
    return out;
  }, [values, extracted]);

  const editedCount = Object.keys(corrections).length;

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const { report: analyzed } = await analyzeReport(report.id, corrections);
      onAnalyzed(analyzed);
    } catch (e) {
      setError(e);
      if (e.report) onReportChange(e.report);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="review">
      <div className="section-head">
        <div>
          <h1>Check the extracted values</h1>
          <p>
            The Document Agent read {Object.keys(extracted).length - missingCount} of{" "}
            {Object.keys(extracted).length} fields. Correct anything it misread, or fill in values the
            document discloses. Leave a field empty if the value is not disclosed — it will never be estimated.
          </p>
        </div>
      </div>

      {validation && <ValidationBox validation={validation} />}

      <div className="field-groups">
        {FIELD_GROUPS.map((group) => (
          <fieldset key={group.title} className="field-group">
            <legend>{group.title}</legend>
            {group.fields.map(([key, label]) => {
              const edited = Object.hasOwn(corrections, key);
              const missing = extracted[key] === null && !values[key];
              return (
                <label key={key} className={`field ${edited ? "is-edited" : ""} ${missing ? "is-missing" : ""}`}>
                  <span className="field-label">{label}</span>
                  <input
                    type="text"
                    inputMode={TEXT_FIELDS.has(key) ? "text" : "decimal"}
                    value={values[key] ?? ""}
                    placeholder="Not disclosed"
                    onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                    disabled={running}
                  />
                  {edited && (
                    <span className="field-note">
                      Extracted: {extracted[key] === null ? "none" : formatNumber(extracted[key])}
                    </span>
                  )}
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>

      <div className="action-bar">
        <p className="muted">
          {editedCount === 0
            ? "Monetary values in USD millions, as in the source document."
            : `${editedCount} value${editedCount > 1 ? "s" : ""} corrected. Corrections are recorded in the report.`}
        </p>
        <div className="action-buttons">
          {editedCount > 0 && (
            <button className="btn" onClick={() => setValues(toInputs(extracted))} disabled={running}>
              Undo corrections
            </button>
          )}
          <button className="btn btn-primary" onClick={run} disabled={running}>
            {running ? "Analysing…" : report.risk_assessment ? "Re-run analysis" : "Run risk analysis"}
          </button>
        </div>
      </div>

      {running && (
        <div className="pipeline" role="status">
          <span className="spinner" aria-hidden="true" />
          <div>
            <p><strong>Running the analysis.</strong> This usually takes 20–40 seconds with the LLM.</p>
            <ol>{PIPELINE.map((p) => <li key={p}>{p}</li>)}</ol>
          </div>
        </div>
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          <p><strong>{error.message}</strong>{error.stage ? ` (stage: ${error.stage.replace(/_/g, " ")})` : ""}</p>
          {error.detail && <p className="detail">{error.detail}</p>}
          {error.stage === "validation" && <p>Fill in the required values listed above and run the analysis again.</p>}
        </div>
      )}
    </section>
  );
}

function ValidationBox({ validation }) {
  const { errors = [], warnings = [] } = validation;
  if (!errors.length && !warnings.length) {
    return <p className="alert alert-ok">All consistency checks passed (balance sheet, income statement, cash flow).</p>;
  }
  return (
    <div className={`alert ${errors.length ? "alert-error" : "alert-warn"}`}>
      {errors.length > 0 && (
        <>
          <p><strong>Fix these before running the analysis:</strong></p>
          <ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </>
      )}
      {warnings.length > 0 && (
        <>
          <p><strong>Consistency warnings:</strong></p>
          <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </>
      )}
    </div>
  );
}

function toInput(value) {
  return value === null || value === undefined ? "" : String(value);
}

function toInputs(data) {
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toInput(v)]));
}
