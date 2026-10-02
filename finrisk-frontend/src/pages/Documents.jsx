import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Upload as UploadIcon, FileText, Download, Trash2, Eye, SlidersHorizontal, RefreshCw } from "lucide-react";
import { api, downloadFile } from "../lib/api.js";
import { useAuth, canEdit } from "../lib/auth.jsx";
import { useAnalysis } from "../lib/analysis.jsx";
import {
  Alert, Button, Card, Drawer, EmptyState, Modal, PageHeader, Pill, RiskBadge, Spinner, StatusBadge, Table
} from "../components/ui.jsx";
import ReviewValues from "../components/ReviewValues.jsx";
import ProcessingStepper from "../components/ProcessingStepper.jsx";
import { dateTime, fileSize } from "../lib/format.js";

export default function Documents() {
  const { user } = useAuth();
  const editor = canEdit(user);
  const { refresh, setSelectedId } = useAnalysis();
  const navigate = useNavigate();
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState(null);
  const [review, setReview] = useState(null);
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/api/documents");
      setDocs(r.documents);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Refresh while something is processing.
  useEffect(() => {
    if (!docs?.some((d) => d.status === "analyzing")) return;
    const t = setInterval(() => { load(); refresh(); }, 2500);
    return () => clearInterval(t);
  }, [docs, load, refresh]);

  async function openReview(d) {
    const r = await api.get(`/api/documents/${d.id}`);
    setReview(r.document);
  }

  async function remove() {
    try {
      await api.del(`/api/documents/${toDelete.id}`);
      setToDelete(null);
      await load();
      await refresh();
    } catch (e) {
      setError(e.message);
      setToDelete(null);
    }
  }

  function view(d) {
    setSelectedId(d.id);
    navigate("/analysis");
  }

  const columns = [
    {
      key: "name", label: "Document name", render: (d) => (
        <div className="flex items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500"><FileText className="size-4" /></div>
          <div className="min-w-0">
            <p className="max-w-xs truncate font-medium text-slate-900">{d.filename}</p>
            <p className="text-xs text-slate-500">{d.company_name ?? "Company not detected"} · {fileSize(d.size_bytes)}</p>
          </div>
        </div>
      )
    },
    { key: "type", label: "Type", render: (d) => <Pill>{d.file_type?.toUpperCase()}</Pill> },
    { key: "fy", label: "Fiscal year", render: (d) => d.fiscal_year ?? "—" },
    {
      key: "status", label: "Status", render: (d) => (
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={d.status} />
          {d.status === "completed" && <RiskBadge level={d.overall_risk_level} />}
        </div>
      )
    },
    { key: "date", label: "Uploaded", className: "whitespace-nowrap text-slate-500", render: (d) => dateTime(d.created_at) },
    {
      key: "actions", label: "Actions", align: "right", render: (d) => (
        <div className="flex justify-end gap-1">
          {d.status === "completed" && (
            <>
              <IconBtn title="View analysis" icon={Eye} onClick={() => view(d)} />
              <IconBtn title="Download PDF" icon={Download}
                onClick={() => downloadFile(d.pdf_url, `${d.company_name ?? "FinRisk"}_${d.fiscal_year ?? ""}.pdf`).catch((e) => setError(e.message))} />
            </>
          )}
          {d.status !== "uploaded" && d.error?.stage !== "document_agent" && <IconBtn title={editor ? "Review values" : "View values"} icon={SlidersHorizontal} onClick={() => openReview(d)} />}
          {editor && <IconBtn title="Delete" icon={Trash2} danger onClick={() => setToDelete(d)} disabled={d.status === "analyzing"} />}
        </div>
      )
    }
  ];

  return (
    <>
      <PageHeader
        title="Documents"
        description="Financial documents uploaded by your company and their processing status."
        actions={
          <>
            <Button variant="secondary" icon={RefreshCw} onClick={load}>Refresh</Button>
            {editor && <Link to="/upload"><Button icon={UploadIcon}>Upload Document</Button></Link>}
          </>
        }
      />
      {error && <Alert type="error" className="mb-4">{error}</Alert>}
      <Card>
        {!docs ? <Spinner /> : (
          <Table
            columns={columns}
            rows={docs}
            rowKey={(d) => d.id}
            empty={
              <EmptyState icon={FileText} title="No documents yet"
                description="Uploaded financial statements will appear here."
                action={editor && <Link to="/upload"><Button icon={UploadIcon}>Upload Document</Button></Link>} />
            }
          />
        )}
      </Card>

      <Drawer open={Boolean(review)} onClose={() => setReview(null)} title="Extracted values" subtitle={review?.filename} width="max-w-xl">
        {review && (
          <div className="space-y-6">
            <ProcessingStepper status={review.status} failedStage={review.error?.stage} />
            {review.error && <Alert type="error" title={review.error.message}>{review.error.detail}</Alert>}
            <ReviewValues
              document={review}
              readOnly={!editor || review.status === "analyzing"}
              onStarted={(d, o) => { if (!o?.stay) { setReview(null); load(); } else setReview(d); }}
            />
          </div>
        )}
      </Drawer>

      <Modal
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        title="Delete document?"
        footer={<>
          <Button variant="secondary" onClick={() => setToDelete(null)}>Cancel</Button>
          <Button variant="danger" icon={Trash2} onClick={remove}>Delete</Button>
        </>}
      >
        <p className="text-sm text-slate-600">
          {toDelete?.filename} and its analysis, PDF report and historical-report knowledge entry will be permanently deleted.
        </p>
      </Modal>
    </>
  );
}

function IconBtn({ icon: Icon, title, danger, ...rest }) {
  return (
    <button
      title={title}
      aria-label={title}
      className={`rounded-md p-2 transition-colors disabled:opacity-40 ${danger ? "text-slate-400 hover:bg-red-50 hover:text-red-600" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"}`}
      {...rest}
    >
      <Icon className="size-4" />
    </button>
  );
}
