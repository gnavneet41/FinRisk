// Reusable UI building blocks. Every page is built from these so the
// look stays consistent.
import { useEffect } from "react";
import { X, Loader2, AlertCircle, CheckCircle2, Info, AlertTriangle } from "lucide-react";
import { RISK_STYLE, STATUS_STYLE } from "../lib/format.js";

export const cx = (...c) => c.filter(Boolean).join(" ");

export function Card({ className, children, ...rest }) {
  return (
    <div className={cx("rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-900/[0.03]", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, className }) {
  return (
    <div className={cx("flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const BUTTON = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
  secondary: "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50",
  ghost: "text-slate-600 hover:bg-slate-100",
  danger: "bg-white text-red-600 ring-1 ring-inset ring-red-200 hover:bg-red-50"
};

export function Button({ variant = "primary", size = "md", loading, icon: Icon, className, children, ...rest }) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
        BUTTON[variant],
        className
      )}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className="size-4" /> : null}
      {children}
    </button>
  );
}

export function RiskBadge({ level, className }) {
  const s = RISK_STYLE[level];
  if (!s) return null;
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", s.badge, className)}>
      <span className={cx("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

export function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] ?? { label: status, cls: "bg-slate-100 text-slate-700" };
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", s.cls)}>
      {status === "analyzing" && <Loader2 className="size-3 animate-spin" />}
      {s.label}
    </span>
  );
}

export function Pill({ children, className }) {
  return <span className={cx("inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600", className)}>{children}</span>;
}

const ALERT = {
  error: { cls: "border-red-200 bg-red-50 text-red-800", Icon: AlertCircle },
  warning: { cls: "border-amber-200 bg-amber-50 text-amber-900", Icon: AlertTriangle },
  success: { cls: "border-emerald-200 bg-emerald-50 text-emerald-800", Icon: CheckCircle2 },
  info: { cls: "border-brand-100 bg-brand-50 text-brand-700", Icon: Info }
};

export function Alert({ type = "info", title, children, className }) {
  const { cls, Icon } = ALERT[type];
  return (
    <div className={cx("flex gap-3 rounded-lg border px-4 py-3 text-sm", cls, className)} role={type === "error" ? "alert" : "status"}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={title ? "mt-0.5 opacity-90" : ""}>{children}</div>}
      </div>
    </div>
  );
}

export function Spinner({ label = "Loading…" }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {Icon && (
        <div className="mb-4 grid size-11 place-items-center rounded-full bg-brand-50 text-brand-600">
          <Icon className="size-5" />
        </div>
      )}
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div className={cx("-mx-1 overflow-x-auto", className)}>
      <div className="inline-flex min-w-full gap-1 border-b border-slate-200 px-1" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={value === t.value}
            onClick={() => onChange(t.value)}
            className={cx(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              value === t.value ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"
            )}
          >
            {t.label}
            {t.badge}
          </button>
        ))}
      </div>
    </div>
  );
}

function useEscape(onClose) {
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
}

export function Drawer({ open, onClose, title, subtitle, children, width = "max-w-lg" }) {
  useEscape(onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside className={cx("absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-2xl", width)} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </aside>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }) {
  useEscape(onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

const INPUT = "block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500";

export const Input = ({ className, ...p }) => <input className={cx(INPUT, className)} {...p} />;
export const Select = ({ className, children, ...p }) => <select className={cx(INPUT, "pr-8", className)} {...p}>{children}</select>;
export const Textarea = ({ className, ...p }) => <textarea className={cx(INPUT, className)} {...p} />;

export function Toggle({ checked, onChange, label, description, disabled }) {
  return (
    <label className={cx("flex items-start justify-between gap-4", disabled && "opacity-60")}>
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-slate-500">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx("relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full transition-colors", checked ? "bg-brand-600" : "bg-slate-200")}
      >
        <span className={cx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-5.5" : "translate-x-0.5")} />
      </button>
    </label>
  );
}

export function Table({ columns, rows, rowKey, onRowClick, empty }) {
  if (!rows.length) return empty ?? null;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/60">
            {columns.map((c) => (
              <th key={c.key} className={cx("px-5 py-3 text-left text-xs font-medium text-slate-500", c.className, c.align === "right" && "text-right")}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cx(onRowClick && "cursor-pointer hover:bg-slate-50")}
            >
              {columns.map((c) => (
                <td key={c.key} className={cx("px-5 py-3.5 align-middle text-slate-700", c.className, c.align === "right" && "text-right")}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatCard({ label, value, hint, icon: Icon, tone }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500 sm:text-sm">{label}</p>
        {Icon && <Icon className="hidden size-4 shrink-0 text-slate-400 sm:block" />}
      </div>
      <p className={cx("mt-2 text-lg font-semibold tracking-tight tabular sm:text-2xl", tone ?? "text-slate-900")}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}
