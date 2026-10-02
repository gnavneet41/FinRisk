import { useState } from "react";
import { useAuth } from "../lib/auth.jsx";
import { Alert, Button, Card, Field, Input } from "../components/ui.jsx";

export function PasswordForm({ onDone }) {
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (next.length < 8) return setError("The new password must be at least 8 characters.");
    if (next !== confirm) return setError("The new passwords do not match.");
    setBusy(true);
    try {
      await changePassword(current, next);
      setDone(true);
      setCurrent(""); setNext(""); setConfirm("");
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Current or temporary password">
        <Input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label="New password" hint="At least 8 characters.">
        <Input type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Field label="Confirm new password">
        <Input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      {error && <Alert type="error">{error}</Alert>}
      {done && <Alert type="success">Password changed. Other sessions have been signed out.</Alert>}
      <Button type="submit" loading={busy}>Change password</Button>
    </form>
  );
}

export default function ChangePassword() {
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md p-8">
        <h1 className="text-xl font-semibold text-slate-900">Choose a new password</h1>
        <p className="mt-1 text-sm text-slate-500">
          {user.email} is using a temporary password. Set your own password to continue.
        </p>
        <div className="mt-6"><PasswordForm /></div>
        <button onClick={logout} className="mt-6 text-sm text-slate-500 hover:text-slate-800">Sign out</button>
      </Card>
    </div>
  );
}
