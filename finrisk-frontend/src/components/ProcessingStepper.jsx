import { Check, Loader2, AlertTriangle, X } from "lucide-react";
import { cx } from "./ui.jsx";

// Uploaded -> Extracted -> Validated -> Analyzed -> Completed
const STEPS = ["Uploaded", "Extracted", "Validated", "Analyzed", "Completed"];

function stepState(status) {
  // index of the step in progress, and whether something went wrong there
  switch (status) {
    case "uploaded": return { done: 1, active: 1 };
    case "extracted": return { done: 2, active: 2 };
    case "validated": return { done: 3, active: null };
    case "needs_review": return { done: 2, problem: 2 };
    case "analyzing": return { done: 3, active: 3 };
    case "completed": return { done: 5, active: null };
    default: return { done: 0, active: null };
  }
}

export default function ProcessingStepper({ status, failedStage }) {
  let { done, active, problem } = stepState(status);
  if (status === "failed") {
    const idx = failedStage === "document_agent" ? 1 : 3;
    done = idx; problem = idx;
  }

  return (
    <ol className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-0">
      {STEPS.map((label, i) => {
        const isDone = i < done;
        const isActive = i === active;
        const isProblem = i === problem;
        return (
          <li key={label} className="flex items-center sm:flex-1">
            <div className="flex items-center gap-2.5">
              <span className={cx(
                "grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold ring-1 ring-inset",
                isDone && "bg-brand-600 text-white ring-brand-600",
                isActive && "bg-brand-50 text-brand-700 ring-brand-300",
                isProblem && (status === "failed" ? "bg-red-50 text-red-600 ring-red-200" : "bg-amber-50 text-amber-700 ring-amber-300"),
                !isDone && !isActive && !isProblem && "bg-white text-slate-400 ring-slate-200"
              )}>
                {isDone ? <Check className="size-4" />
                  : isActive ? <Loader2 className="size-4 animate-spin" />
                  : isProblem ? (status === "failed" ? <X className="size-4" /> : <AlertTriangle className="size-4" />)
                  : i + 1}
              </span>
              <span className={cx("text-sm font-medium", isDone || isActive ? "text-slate-900" : isProblem ? "text-amber-800" : "text-slate-400")}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <span className={cx("mx-3 hidden h-px flex-1 sm:block", i < done - 1 ? "bg-brand-600" : "bg-slate-200")} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
