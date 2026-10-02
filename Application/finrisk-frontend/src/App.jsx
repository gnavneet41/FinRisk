import { useEffect, useState } from "react";
import { getHealth, getReport } from "./api.js";
import UploadStep from "./components/UploadStep.jsx";
import ReviewStep from "./components/ReviewStep.jsx";
import AssessmentView from "./components/AssessmentView.jsx";
import ChatPanel from "./components/ChatPanel.jsx";

const STEPS = [
  { key: "upload", label: "Upload report" },
  { key: "review", label: "Check extracted values" },
  { key: "assessment", label: "Risk assessment" }
];

export default function App() {
  const [step, setStep] = useState("upload");
  const [report, setReport] = useState(null);
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(false);

  useEffect(() => {
    getHealth()
      .then((h) => setHealth(h.llm))
      .catch(() => setHealthError(true));
  }, []);

  // Start each step at the top of the page.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const analyzed = Boolean(report?.risk_assessment);

  function handleUploaded(newReport) {
    setReport(newReport);
    setStep("review");
  }

  function handleAnalyzed(newReport) {
    setReport(newReport);
    setStep("assessment");
  }

  async function openReport(id) {
    const { report: loaded } = await getReport(id);
    setReport(loaded);
    setStep(loaded.risk_assessment ? "assessment" : "review");
  }

  function startOver() {
    setReport(null);
    setStep("upload");
  }

  function canOpen(key) {
    if (key === "upload") return true;
    if (key === "review") return Boolean(report);
    return analyzed;
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="wordmark" onClick={startOver} aria-label="FinRisk home">
          Fin<span>Risk</span>
        </button>
        <p className="tagline">Multi-agent financial risk assessment</p>
        <LlmStatus health={health} error={healthError} />
      </header>

      <nav className="steps" aria-label="Progress">
        <ol>
          {STEPS.map((s, i) => (
            <li key={s.key}>
              <button
                className={`step ${s.key === step ? "is-current" : ""} ${i < stepIndex ? "is-done" : ""}`}
                onClick={() => canOpen(s.key) && setStep(s.key)}
                disabled={!canOpen(s.key)}
                aria-current={s.key === step ? "step" : undefined}
              >
                <span className="step-num">{i + 1}</span>
                {s.label}
              </button>
            </li>
          ))}
        </ol>
        {report && (
          <p className="current-doc">
            {report.financial_data?.company ?? "Unknown company"} {report.financial_data?.fiscal_year ?? ""}
            <span> from {report.document?.filename}</span>
          </p>
        )}
      </nav>

      <main className={step === "assessment" ? "layout-with-chat" : "layout-single"}>
        <div className="main-column">
          {step === "upload" && <UploadStep onUploaded={handleUploaded} onOpenReport={openReport} />}
          {step === "review" && report && (
            <ReviewStep report={report} onAnalyzed={handleAnalyzed} onReportChange={setReport} />
          )}
          {step === "assessment" && analyzed && (
            <AssessmentView report={report} onEditValues={() => setStep("review")} />
          )}
        </div>
        {step === "assessment" && analyzed && (
          <aside className="chat-column">
            <ChatPanel report={report} key={report.id + report.updated_at} />
          </aside>
        )}
      </main>
    </div>
  );
}

function LlmStatus({ health, error }) {
  if (error) {
    return <p className="llm-status is-off">Backend not reachable</p>;
  }
  if (!health) return <p className="llm-status">Checking backend…</p>;
  if (!health.configured) {
    return (
      <p className="llm-status is-fallback" title="No LLM key configured: agents use the rule-based fallback">
        LLM off: rule-based mode
      </p>
    );
  }
  return (
    <p className="llm-status is-on" title={health.fallback_enabled ? "Falls back to rules if the LLM is busy" : ""}>
      {health.provider === "gemini" ? "Gemini" : health.provider} ({health.models[0]})
    </p>
  );
}
