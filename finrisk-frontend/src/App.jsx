import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth, isAdmin } from "./lib/auth.jsx";
import { AnalysisProvider } from "./lib/analysis.jsx";
import Layout from "./components/Layout.jsx";
import { Spinner } from "./components/ui.jsx";

import Login from "./pages/Login.jsx";
import ChangePassword from "./pages/ChangePassword.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Documents from "./pages/Documents.jsx";
import Upload from "./pages/Upload.jsx";
import FinancialAnalysis from "./pages/FinancialAnalysis.jsx";
import RiskAssessment from "./pages/RiskAssessment.jsx";
import AskFinRisk from "./pages/AskFinRisk.jsx";
import Reports from "./pages/Reports.jsx";
import KnowledgeBase from "./pages/KnowledgeBase.jsx";
import Settings from "./pages/Settings.jsx";
import AdminOverview from "./pages/admin/AdminOverview.jsx";
import AdminUsers from "./pages/admin/AdminUsers.jsx";
import AdminCompanies from "./pages/admin/AdminCompanies.jsx";
import AdminSystem from "./pages/admin/AdminSystem.jsx";

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <Spinner label="Signing you in…" />;
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  if (user.must_change_password) return <ChangePassword forced />;

  if (isAdmin(user)) {
    return (
      <Layout>
        <Routes>
          <Route path="/admin" element={<AdminOverview />} />
          <Route path="/admin/users" element={<AdminUsers />} />
          <Route path="/admin/companies" element={<AdminCompanies />} />
          <Route path="/admin/system" element={<AdminSystem />} />
          <Route path="/knowledge" element={<KnowledgeBase />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </Layout>
    );
  }

  return (
    <AnalysisProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/analysis" element={<FinancialAnalysis />} />
          <Route path="/risk" element={<RiskAssessment />} />
          <Route path="/ask" element={<AskFinRisk />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/knowledge" element={<KnowledgeBase />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </AnalysisProvider>
  );
}
