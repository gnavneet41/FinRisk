import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileBarChart, Download, ExternalLink } from "lucide-react";
import { api, downloadFile } from "../lib/api.js";
import { useAnalysis } from "../lib/analysis.jsx";
import { Alert, Button, Card, EmptyState, PageHeader, RiskBadge, Spinner, StatusBadge, Table } from "../components/ui.jsx";
import { dateTime } from "../lib/format.js";

export default function Reports() {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState(null);
  const { setSelectedId } = useAnalysis();
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/api/documents").then((r) => setDocs(r.documents.filter((d) => d.status === "completed" || d.status === "analyzing")))
      .catch((e) => setError(e.message));
  }, []);

  const name = (d) => `FinRisk_${(d.company_name ?? "Report").replace(/\W+/g, "_")}_${d.fiscal_year ?? ""}.pdf`;

  const columns = [
    {
      key: "company", label: "Company", render: (d) => (
        <div>
          <p className="font-medium text-slate-900">{d.company_name ?? "—"}</p>
          <p className="max-w-xs truncate text-xs text-slate-500">{d.filename}</p>
        </div>
      )
    },
    { key: "fy", label: "Fiscal year", render: (d) => d.fiscal_year ?? "—" },
    { key: "risk", label: "Overall risk", render: (d) => d.overall_risk_level ? <RiskBadge level={d.overall_risk_level} /> : "—" },
    { key: "generated", label: "Generated", className: "whitespace-nowrap text-slate-500", render: (d) => dateTime(d.analyzed_at) },
    { key: "status", label: "Status", render: (d) => <StatusBadge status={d.status} /> },
    {
      key: "actions", label: "", align: "right", render: (d) => d.status === "completed" && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" icon={ExternalLink}
            onClick={() => downloadFile(`${d.pdf_url}?inline=1`, name(d), { open: true }).catch((e) => setError(e.message))}>
            View Report
          </Button>
          <Button size="sm" icon={Download}
            onClick={() => downloadFile(d.pdf_url, name(d)).catch((e) => setError(e.message))}>
            Download PDF
          </Button>
        </div>
      )
    }
  ];

  return (
    <>
      <PageHeader title="Reports" description="Financial risk reports generated from completed analyses." />
      {error && <Alert type="error" className="mb-4">{error}</Alert>}
      <Card>
        {!docs ? <Spinner /> : (
          <Table
            columns={columns}
            rows={docs}
            rowKey={(d) => d.id}
            onRowClick={(d) => { if (d.status === "completed") { setSelectedId(d.id); navigate("/risk"); } }}
            empty={<EmptyState icon={FileBarChart} title="No reports yet" description="A report is generated each time an analysis completes." />}
          />
        )}
      </Card>
      {docs?.length > 0 && <p className="mt-3 text-xs text-slate-500">Click a row to open its risk assessment.</p>}
    </>
  );
}
