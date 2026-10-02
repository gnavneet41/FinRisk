// Which completed analysis the analysis pages are showing.
// Defaults to the most recent completed document of the company.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api.js";
import { useAuth, isAdmin } from "./auth.jsx";

const AnalysisContext = createContext(null);
const KEY = "finrisk_selected_document";

export function AnalysisProvider({ children }) {
  const { user } = useAuth();
  const [completed, setCompleted] = useState([]);
  const [selectedId, setSelectedIdState] = useState(() => {
    try { return localStorage.getItem(KEY); } catch { return null; }
  });
  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const setSelectedId = (id) => {
    setSelectedIdState(id);
    try { id ? localStorage.setItem(KEY, id) : localStorage.removeItem(KEY); } catch { /* ignore */ }
  };

  const refresh = useCallback(async () => {
    if (!user || isAdmin(user) || user.must_change_password) return;
    const r = await api.get("/api/documents?status=completed");
    setCompleted(r.documents);
    setSelectedIdState((current) => {
      const exists = r.documents.some((d) => d.id === current);
      const next = exists ? current : r.documents[0]?.id ?? null;
      try { next ? localStorage.setItem(KEY, next) : localStorage.removeItem(KEY); } catch { /* ignore */ }
      return next;
    });
  }, [user]);

  useEffect(() => { refresh().catch(() => {}); }, [refresh]);

  useEffect(() => {
    if (!selectedId) { setDocument(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get(`/api/documents/${selectedId}`)
      .then((r) => { if (!cancelled) setDocument(r.document); })
      .catch((e) => { if (!cancelled) { setError(e.message); setDocument(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  return (
    <AnalysisContext.Provider value={{ completed, selectedId, setSelectedId, document, loading, error, refresh }}>
      {children}
    </AnalysisContext.Provider>
  );
}

export const useAnalysis = () => useContext(AnalysisContext);
