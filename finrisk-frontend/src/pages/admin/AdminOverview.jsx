import { useCallback, useEffect, useState } from "react";
import { Users, Building2, FileText, BookOpen, Cpu, Database, Clock, RefreshCw } from "lucide-react";
import { api } from "../../lib/api.js";
import { Alert, Button, Card, CardHeader, PageHeader, Spinner, StatCard, Table, cx } from "../../components/ui.jsx";
import { dateTime, titleCase } from "../../lib/format.js";

export function Monitoring() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    api.get("/api/admin/system/monitoring").then(setData).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <Spinner />;
  const m = data.monitoring;
  const llm = m.llm_last_24h;
  const uptime = m.server.uptime_seconds;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Users" value={m.counts.users} icon={Users} hint={`${m.counts.active_users} active`} />
        <StatCard label="Companies" value={m.counts.companies} icon={Building2} hint={`${m.counts.active_companies} active`} />
        <StatCard label="Documents" value={m.counts.documents} icon={FileText}
          hint={`${m.counts.completed_documents} completed · ${m.counts.processing_documents} processing · ${m.counts.failed_documents} failed`} />
        <StatCard label="Knowledge documents" value={m.counts.global_knowledge + m.counts.company_knowledge} icon={BookOpen}
          hint={`${m.counts.global_knowledge} global · ${m.counts.company_knowledge} private`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader title="Server" action={<Button size="sm" variant="ghost" icon={RefreshCw} onClick={load}>Refresh</Button>} />
          <dl className="divide-y divide-slate-100 text-sm">
            <Row icon={Database} label="Database" value={<Health ok={m.server.database === "connected"} text={titleCase(m.server.database)} />} />
            <Row icon={Cpu} label="Language model" value={<Health ok={data.llm_status.configured} text={data.llm_status.configured ? `${data.llm_status.provider} (${data.llm_status.models[0]})` : "Not configured"} />} />
            <Row icon={Clock} label="Uptime" value={`${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`} />
            <Row label="Memory" value={`${m.server.memory_mb} MB`} />
            <Row label="Node.js" value={m.server.node_version} />
          </dl>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Language model calls" subtitle="Last 24 hours" />
          <div className="grid gap-4 p-5 sm:grid-cols-4">
            <Metric label="Calls" value={llm.calls} />
            <Metric label="Success rate" value={llm.success_rate === null ? "—" : `${Math.round(llm.success_rate * 100)}%`}
              tone={llm.success_rate !== null && llm.success_rate < 0.8 ? "text-amber-700" : ""} />
            <Metric label="Failed" value={llm.failed} tone={llm.failed ? "text-red-600" : ""} />
            <Metric label="Avg latency" value={llm.avg_latency_ms ? `${(llm.avg_latency_ms / 1000).toFixed(1)}s` : "—"} />
          </div>
          {Object.keys(llm.by_agent).length > 0 && (
            <div className="space-y-2 border-t border-slate-100 p-5">
              {Object.entries(llm.by_agent).map(([agent, c]) => {
                const total = c.success + c.failed;
                return (
                  <div key={agent} className="text-sm">
                    <div className="flex justify-between"><span className="text-slate-700">{agent}</span><span className="tabular text-slate-500">{c.success}/{total} succeeded</span></div>
                    <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="bg-brand-500" style={{ width: `${(c.success / total) * 100}%` }} />
                      <div className="ml-0.5 bg-red-400" style={{ width: `${(c.failed / total) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {m.recent_errors.length > 0 && (
        <Card>
          <CardHeader title="Recent errors" />
          <EventTable events={m.recent_errors} />
        </Card>
      )}
      <Card>
        <CardHeader title="Recent activity" subtitle="Metadata only — document contents are never logged" />
        <EventTable events={m.recent_events} />
      </Card>
    </div>
  );
}

function EventTable({ events }) {
  return (
    <Table
      rowKey={(e) => e.id}
      rows={events}
      columns={[
        { key: "at", label: "Time", className: "whitespace-nowrap text-slate-500", render: (e) => dateTime(e.at) },
        { key: "type", label: "Type", render: (e) => <span className={cx("rounded px-1.5 py-0.5 text-xs font-medium",
          e.level === "error" ? "bg-red-50 text-red-700" : e.level === "warning" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600")}>{e.type.replace("_", " ")}</span> },
        { key: "message", label: "Event", render: (e) => <span className="text-slate-800">{e.message}</span> },
        { key: "who", label: "Company / user", className: "text-slate-500", render: (e) => e.company ?? e.user ?? "—" }
      ]}
    />
  );
}

const Row = ({ icon: Icon, label, value }) => (
  <div className="flex items-center justify-between gap-3 px-5 py-3">
    <dt className="flex items-center gap-2 text-slate-500">{Icon && <Icon className="size-4" />}{label}</dt>
    <dd className="text-right font-medium text-slate-800">{value}</dd>
  </div>
);
const Metric = ({ label, value, tone }) => (
  <div><p className="text-xs text-slate-500">{label}</p><p className={cx("mt-1 text-xl font-semibold tabular", tone || "text-slate-900")}>{value}</p></div>
);
const Health = ({ ok, text }) => (
  <span className="inline-flex items-center gap-1.5"><span className={cx("size-2 rounded-full", ok ? "bg-emerald-500" : "bg-amber-500")} />{text}</span>
);

export default function AdminOverview() {
  return (
    <>
      <PageHeader title="System overview" description="Platform health, usage and recent activity. Refreshes every 15 seconds." />
      <Monitoring />
    </>
  );
}
