import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { UploadCloud, FileSpreadsheet, FileText, Download, ArrowRight } from "lucide-react";
import { api, downloadFile } from "../lib/api.js";
import { useAuth, canEdit } from "../lib/auth.jsx";
import { useAnalysis } from "../lib/analysis.jsx";
import { Alert, Button, Card, CardHeader, Drawer, PageHeader, RiskBadge, cx } from "../components/ui.jsx";
import ProcessingStepper from "../components/ProcessingStepper.jsx";
import ReviewValues from "../components/ReviewValues.jsx";
import { fileSize } from "../lib/format.js";

const ACCEPT = ".pdf,.csv,.xlsx,.docx";

export default function Upload() {
  const { user } = useAuth();
  const { refresh, setSelectedId } = useAnalysis();
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState(null);
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  // Poll while the analysis runs in the background.
  useEffect(() => {
    if (!doc || !["uploaded", "extracted", "validated", "analyzing"].includes(doc.status) || doc.status === "validated") return;
    const t = setInterval(async () => {
      try {
        const r = await api.get(`/api/documents/${doc.id}`);
        setDoc(r.document);
        if (r.document.status === "completed") {
          await refresh();
          setSelectedId(r.document.id);
        }
      } catch { /* keep polling */ }
    }, 1500);
    return () => clearInterval(t);
  }, [doc, refresh, setSelectedId]);

  if (!canEdit(user)) {
    return (
      <>
        <PageHeader title="Upload Document" />
        <Alert type="info">Your role is read-only. Ask an analyst in your company to upload documents.</Alert>
      </>
    );
  }

  async function upload(f) {
    if (!f) return;
    if (!/\.(pdf|csv|xlsx|docx)$/i.test(f.name)) {
      setError("Choose a PDF, CSV or Excel (.xlsx) file.");
      return;
    }
    setFile(f);
    setError(null);
    setDoc(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("document", f);
      const r = await api.upload("/api/documents/upload", form);
      setDoc(r.document);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function startAnalysis() {
    try {
      const r = await api.post(`/api/documents/${doc.id}/analyze`, {});
      setDoc(r.document);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
      <PageHeader
        title="Upload Document"
        description="Upload a financial statement. FinRisk extracts the values, validates them, calculates the ratios and assesses the risk."
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files[0]); }}
              className={cx(
                "m-2 flex flex-col items-center rounded-lg border-2 border-dashed px-6 py-14 text-center transition-colors",
                dragging ? "border-brand-500 bg-brand-50" : "border-slate-200"
              )}
            >
              <div className="grid size-12 place-items-center rounded-full bg-brand-50 text-brand-600">
                <UploadCloud className="size-6" />
              </div>
              <p className="mt-4 text-base font-semibold text-slate-900">Drag and drop your file here</p>
              <p className="mt-1 text-sm text-slate-500">PDF, CSV or Excel (.xlsx)</p>
              <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={(e) => { upload(e.target.files[0]); e.target.value = ""; }} />
              <Button className="mt-5" onClick={() => inputRef.current?.click()} loading={busy}>
                {busy ? "Uploading…" : "Browse files"}
              </Button>
            </div>
          </Card>

          {error && <Alert type="error">{error}</Alert>}

          {(doc || busy) && (
            <Card>
              <CardHeader
                title={file?.name ?? doc?.filename}
                subtitle={file ? fileSize(file.size) : null}
                action={doc?.status === "completed" && <RiskBadge level={doc.overall_risk_level} />}
              />
              <div className="space-y-5 p-5">
                <ProcessingStepper status={doc?.status ?? "uploaded"} failedStage={doc?.error?.stage} />

                {doc?.status === "analyzing" && (
                  <p className="text-sm text-slate-500">
                    The Analysis Agent and Risk Advisor are working. With the language model this takes about 20–40 seconds.
                  </p>
                )}
                {doc?.status === "validated" && (
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-sm text-slate-600">Values extracted and validated. Automatic analysis is switched off.</p>
                    <Button onClick={startAnalysis}>Run analysis</Button>
                    <Button variant="secondary" onClick={() => setReviewOpen(true)}>Review values</Button>
                  </div>
                )}
                {doc?.status === "needs_review" && (
                  <Alert type="warning" title="Some required values could not be found">
                    <p>Check the extracted values and fill in what the document discloses.</p>
                    <Button className="mt-3" size="sm" onClick={() => setReviewOpen(true)}>Review values</Button>
                  </Alert>
                )}
                {doc?.status === "failed" && (
                  <Alert type="error" title={doc.error?.message ?? "Processing failed"}>
                    {doc.error?.detail}
                  </Alert>
                )}
                {doc?.status === "completed" && (
                  <div className="flex flex-wrap gap-2">
                    <Link to="/"><Button icon={ArrowRight}>Open dashboard</Button></Link>
                    <Link to="/risk"><Button variant="secondary">Risk assessment</Button></Link>
                    <Button variant="secondary" onClick={() => setReviewOpen(true)}>Review values</Button>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>

        <Card className="h-fit">
          <CardHeader title="Supported formats" />
          <ul className="space-y-4 p-5 text-sm">
            <li className="flex gap-3">
              <FileText className="mt-0.5 size-4 shrink-0 text-slate-400" />
              <span><span className="font-medium text-slate-900">PDF</span> — financial statements laid out like the sample Apple 10-K summary.</span>
            </li>
            <li className="flex gap-3">
              <FileSpreadsheet className="mt-0.5 size-4 shrink-0 text-slate-400" />
              <span><span className="font-medium text-slate-900">CSV or Excel</span> — a table with a line item column and a value column (e.g. "Revenue, 391035").</span>
            </li>
          </ul>
          <div className="space-y-2 border-t border-slate-100 p-5">
            <p className="text-sm font-medium text-slate-900">Templates with sample data</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" icon={Download}
                onClick={() => downloadFile("/api/documents/templates/csv", "finrisk_template.csv").catch((e) => setError(e.message))}>
                CSV
              </Button>
              <Button variant="secondary" size="sm" icon={Download}
                onClick={() => downloadFile("/api/documents/templates/xlsx", "finrisk_template.xlsx").catch((e) => setError(e.message))}>
                Excel
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <Drawer open={reviewOpen && doc} onClose={() => setReviewOpen(false)} title="Review extracted values" subtitle={doc?.filename}>
        {doc && <ReviewValues document={doc} onStarted={(d, o) => { setDoc(d); if (!o?.stay) setReviewOpen(false); }} />}
      </Drawer>
    </>
  );
}
