import { useState } from "react";
import { ShieldCheck, LineChart, BookOpen } from "lucide-react";
import { useAuth } from "../lib/auth.jsx";
import { Alert, Button, Field, Input } from "../components/ui.jsx";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-lg bg-brand-600 font-bold text-white">F</div>
            <span className="text-xl font-semibold tracking-tight">FinRisk</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Use the account your administrator created for you.</p>

          <form onSubmit={submit} className="mt-8 space-y-5">
            <Field label="Email">
              <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password">
              <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && <Alert type="error">{error}</Alert>}
            <Button type="submit" loading={busy} className="w-full">Sign in</Button>
          </form>
          <p className="mt-6 text-xs text-slate-500">Forgot your password? Ask your FinRisk administrator to reset your access.</p>
        </div>
      </div>

      <div className="relative hidden overflow-hidden bg-slate-900 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(42,120,214,0.45),transparent_60%)]" />
        <div className="relative flex h-full flex-col justify-center px-16 text-white">
          <p className="text-sm font-medium text-brand-100">Multi-agent financial risk assessment</p>
          <h2 className="mt-3 max-w-md text-3xl font-semibold leading-tight tracking-tight">
            From financial statements to an explained risk assessment.
          </h2>
          <ul className="mt-10 space-y-5 text-sm text-slate-300">
            {[
              [LineChart, "Ratios are calculated in code, never by the language model."],
              [ShieldCheck, "Every risk conclusion cites the numbers that support it."],
              [BookOpen, "Explanations draw on accounting standards and your own company knowledge."]
            ].map(([Icon, text]) => (
              <li key={text} className="flex gap-3">
                <Icon className="mt-0.5 size-4 shrink-0 text-brand-100" /> {text}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
