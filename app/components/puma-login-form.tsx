'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function PumaLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setStatus('Signing in…');
    try {
      const response = await fetch('/api/account/sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || 'Unable to sign in.');
      setStatus('Signed in. Opening Puma…');
      router.replace('/');
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="pm-account-form" onSubmit={submit}>
      <label><span>Email</span><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label><span>Password</span><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <small>Email sign-in is optional. Puma still works on a single device without an account.</small>
      {status && <p role="status" aria-live="polite">{status}</p>}
    </form>
  );
}
