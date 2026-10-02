// Review and correct the values the Document Agent extracted, then
// re-run the analysis. Used from the Documents page and after upload.
import { useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { FIELD_GROUPS, number } from "../lib/format.js";
import { Alert, Button, cx } from "./ui.jsx";

const TEXT_FIELDS = new Set(["company", "fiscal_year"]);
const toInput = (v) => (v === null || v === undefined ? "" : String(v));

export default function ReviewValues({ document: doc, onStarted, readOnly }) {
  const extracted = doc.extracted_data ?? {};
  const [values, setValues] = useState(() =>
    Object.fromEntries(Object.entries(doc.financial_data ?? {}).map(([k, v]) => [k, toInput(v)]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const corrections = useMemo(() => {
    const out = {};
    for (const [k, v] of Object.entries(values)) if (v !== toInput(extracted[k])) out[k] = v === "" ? null : v;
    return out;
  }, [values, extracted]);

  const { errors = [], warnings = [] } = doc.validation ?? {};
  const found = Object.values(extracted).filter((v) => v !== null).length;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post(`/api/documents/${doc.id}/analyze`, { financial_data: corrections });
      onStarted?.(r.document);
    } catch (e) {
      setError(e.message);
      if (e.body?.document) onStarted?.(e.body.document, { stay: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-600">
        The Document Agent found {found} of {Object.keys(extracted).length} values. Correct anything it misread or fill in values
        the document discloses. Leave a field empty if it is not disclosed — FinRisk never estimates missing values.
      </p>

      {errors.length > 0 && (
        <Alert type="error" title="Required values are missing">
          <ul className="list-disc pl-4">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert type="warning" title="Consistency warnings">
          <ul className="list-disc pl-4">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </Alert>
      )}
      {!errors.length && !warnings.length && doc.validation && (
        <Alert type="success">All consistency checks passed.</Alert>
      )}

      {FIELD_GROUPS.map((g) => (
        <fieldset key={g.title}>
          <legend className="mb-2 text-sm font-semibold text-slate-900">{g.title}</legend>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {g.fields.map(([key, label]) => {
              const edited = Object.hasOwn(corrections, key);
              return (
                <label key={key} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-sm text-slate-700">
                    {label}
                    {edited && <span className="ml-2 text-xs text-brand-600">was {extracted[key] === null ? "empty" : number(extracted[key])}</span>}
                  </span>
                  <input
                    value={values[key] ?? ""}
                    disabled={readOnly || busy}
                    inputMode={TEXT_FIELDS.has(key) ? "text" : "decimal"}
                    placeholder="Not disclosed"
                    onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                    className={cx(
                      "w-36 rounded-md border-0 px-2 py-1 text-right text-sm tabular ring-1 ring-inset focus:ring-2 focus:ring-brand-500 focus:outline-none",
                      edited ? "bg-brand-50 ring-brand-300" : "ring-slate-200",
                      extracted[key] === null && !values[key] && "ring-dashed"
                    )}
                  />
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      {error && <Alert type="error">{error}</Alert>}
      {!readOnly && (
        <div className="sticky bottom-0 -mx-6 flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-3">
          <span className="text-xs text-slate-500">
            {Object.keys(corrections).length ? `${Object.keys(corrections).length} value(s) corrected` : "USD millions"}
          </span>
          <Button onClick={run} loading={busy}>
            {doc.risk_assessment ? "Re-run analysis" : "Run analysis"}
          </Button>
        </div>
      )}
    </div>
  );
}
