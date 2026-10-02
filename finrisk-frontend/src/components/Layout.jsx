import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, FileText, BarChart3, ShieldAlert, MessageSquareText, FileBarChart,
  BookOpen, Settings, Users, Building2, SlidersHorizontal, Activity, Menu, X, LogOut, ChevronDown
} from "lucide-react";
import { useAuth, isAdmin } from "../lib/auth.jsx";
import { useAnalysis } from "../lib/analysis.jsx";
import { cx } from "./ui.jsx";
import { titleCase } from "../lib/format.js";

const USER_NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/documents", label: "Documents", icon: FileText },
  { to: "/analysis", label: "Financial Analysis", icon: BarChart3 },
  { to: "/risk", label: "Risk Assessment", icon: ShieldAlert },
  { to: "/ask", label: "Ask FinRisk", icon: MessageSquareText },
  { to: "/reports", label: "Reports", icon: FileBarChart },
  { to: "/knowledge", label: "Knowledge Base", icon: BookOpen },
  { to: "/settings", label: "Settings", icon: Settings }
];

const ADMIN_NAV = [
  { to: "/admin", label: "Overview", icon: Activity, end: true },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/companies", label: "Companies", icon: Building2 },
  { to: "/admin/system", label: "System", icon: SlidersHorizontal },
  { to: "/knowledge", label: "Global Knowledge", icon: BookOpen },
  { to: "/settings", label: "Settings", icon: Settings }
];

// Pages that show the currently selected analysis.
const ANALYSIS_PAGES = ["/", "/analysis", "/risk", "/ask"];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const admin = isAdmin(user);
  const nav = admin ? ADMIN_NAV : USER_NAV;

  useEffect(() => { setOpen(false); window.scrollTo({ top: 0 }); }, [location.pathname]);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <div className="grid size-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">F</div>
        <span className="text-lg font-semibold tracking-tight text-slate-900">FinRisk</span>
        {admin && <span className="ml-auto rounded-md bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">Admin</span>}
      </div>
      <nav className="flex-1 space-y-0.5 px-3 py-2" aria-label="Main">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => cx(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            )}
          >
            <Icon className="size-4.5 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-200 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
            {user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-900">{user.name}</p>
            <p className="truncate text-xs text-slate-500">
              {admin ? "Administrator" : `${titleCase(user.role)} · ${user.company?.name ?? ""}`}
            </p>
          </div>
          <button onClick={logout} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Sign out" aria-label="Sign out">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white lg:block">{sidebar}</aside>

      {/* Mobile sidebar */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl">
            <button onClick={() => setOpen(false)} className="absolute right-3 top-4 rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close menu">
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6 lg:px-8">
          <button onClick={() => setOpen(true)} className="-ml-1 rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <span className="font-semibold text-slate-900 lg:hidden">FinRisk</span>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            {!admin && ANALYSIS_PAGES.includes(location.pathname) && <AnalysisSelector />}
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

function AnalysisSelector() {
  const { completed, selectedId, setSelectedId } = useAnalysis();
  const navigate = useNavigate();
  if (!completed.length) {
    return (
      <button onClick={() => navigate("/upload")} className="text-sm font-medium text-brand-600 hover:text-brand-700">
        Upload a document to start
      </button>
    );
  }
  return (
    <label className="relative flex min-w-0 items-center gap-2 text-sm">
      <span className="hidden text-slate-500 sm:inline">Analysis</span>
      <select
        value={selectedId ?? ""}
        onChange={(e) => setSelectedId(e.target.value)}
        className="min-w-0 max-w-[16rem] appearance-none truncate rounded-lg border-0 bg-slate-50 py-1.5 pl-3 pr-8 font-medium text-slate-800 ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-brand-500"
      >
        {completed.map((d) => (
          <option key={d.id} value={d.id}>
            {d.company_name ?? d.filename} {d.fiscal_year ?? ""} — {d.filename}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 size-4 text-slate-400" />
    </label>
  );
}
