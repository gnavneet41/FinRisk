import { useEffect, useRef, useState } from "react";
import { listReports, uploadDocument } from "../api.js";
import { capitalize } from "../format.js";

const ACCEPTED = ".pdf,.docx";

export default function UploadStep({ onUploaded, onOpenReport }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [reports, setReports] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => {
    listReports().then((r) => setReports(r.reports)).catch(() => {});
  }, []);

  async function handleFile(file) {
    if (!file) return;
    if (!/\.(pdf|docx)$/i.test(file.name)) {
      setError("Choose a PDF or DOCX file. Other formats are not supported yet.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { report } = await uploadDocument(file);
      onUploaded(report);
    } catch (e) {
      setError(e.message + (e.detail ? `: ${e.detail}` : ""));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="upload">
      <div className="intro">
        <h1>Upload a financial report to assess its risk</h1>
        <p>
          FinRisk reads the statements, calculates the ratios in code, and has the Risk Advisor
          explain what they mean, citing the evidence for every conclusion.
        </p>
      </div>

      <div
        className={`dropzone ${dragging ? "is-dragging" : ""} ${busy ? "is-busy" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFile(e.dataTransfer.files[0]);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          hidden
          onChange={(e) => handleFile(e.target.files[0])}
        />
        {busy ? (
          <p className="dropzone-main"><span className="spinner" aria-hidden="true" /> Reading the document…</p>
        ) : (
          <>
            <p className="dropzone-main">Drop a PDF or DOCX here</p>
            <button className="btn btn-primary" onClick={() => inputRef.current?.click()}>
              Choose file
            </button>
            <p className="hint">Values are extracted locally. No document text is sent to the LLM.</p>
          </>
        )}
      </div>

      {error && <p className="alert alert-error" role="alert">{error}</p>}

      {reports.length > 0 && (
        <div className="history">
          <h2>Previous reports</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Period</th>
                <th>File</th>
                <th>Overall risk</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {reports.slice(0, 8).map((r) => (
                <tr key={r.id} className="row-link" onClick={() => onOpenReport(r.id)}>
                  <td>
                    <button className="link" onClick={(e) => { e.stopPropagation(); onOpenReport(r.id); }}>
                      {r.company ?? "Unknown company"}
                    </button>
                  </td>
                  <td>{r.fiscal_year ?? "—"}</td>
                  <td className="muted">{r.filename}</td>
                  <td>
                    {r.overall_level
                      ? <span className={`level level-${r.overall_level}`}>{capitalize(r.overall_level)}</span>
                      : <span className="muted">Not analysed</span>}
                  </td>
                  <td className="muted num">{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
