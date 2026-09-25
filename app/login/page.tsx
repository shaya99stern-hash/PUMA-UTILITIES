'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabase } from '../../lib/supabase-browser';

const REMEMBERED_EMAIL_KEY = 'puma-login-email';

type Step = 'email' | 'code';

export default function LoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabase(), []);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>('email');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const remembered = window.localStorage.getItem(REMEMBERED_EMAIL_KEY)?.trim();
    if (remembered) setEmail(remembered);
  }, []);

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;
    setBusy(true);
    setError('');
    setMessage('');
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: normalized,
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (sendError) {
      setError(sendError.message);
      return;
    }
    window.localStorage.setItem(REMEMBERED_EMAIL_KEY, normalized);
    setEmail(normalized);
    setStep('code');
    setMessage('Enter the 6-digit code sent to your email.');
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    const token = code.replace(/\D/g, '').slice(0, 6);
    if (token.length !== 6) {
      setError('Enter the full 6-digit code.');
      return;
    }
    setBusy(true);
    setError('');
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token,
      type: 'email',
    });
    setBusy(false);
    if (verifyError) {
      setError(verifyError.message);
      return;
    }
    window.localStorage.setItem(REMEMBERED_EMAIL_KEY, email.trim().toLowerCase());
    router.replace('/');
    router.refresh();
  }

  return (
    <main className="pm-login-shell">
      <section className="pm-login-card" aria-labelledby="puma-login-title">
        <div className="pm-login-mark">P</div>
        <p className="pm-login-eyebrow">Puma Utilities</p>
        <h1 id="puma-login-title">{step === 'email' ? 'Sign in' : 'Check your email'}</h1>
        <p className="pm-login-copy">
          {step === 'email'
            ? 'Use your email to receive a one-time 6-digit sign-in code.'
            : `We sent a 6-digit code to ${email}.`}
        </p>

        {step === 'email' ? (
          <form className="pm-login-form" onSubmit={sendCode}>
            <label>
              <span>Email</span>
              <input
                autoComplete="email"
                inputMode="email"
                name="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>
            <button type="submit" disabled={busy || !email.trim()}>
              {busy ? 'Sending…' : 'Send 6-digit code'}
            </button>
          </form>
        ) : (
          <form className="pm-login-form" onSubmit={verifyCode}>
            <label>
              <span>Verification code</span>
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                name="code"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="pm-login-code"
                required
              />
            </label>
            <button type="submit" disabled={busy || code.length !== 6}>
              {busy ? 'Verifying…' : 'Verify and continue'}
            </button>
            <div className="pm-login-secondary-actions">
              <button type="button" onClick={() => sendCode()} disabled={busy}>Resend code</button>
              <button type="button" onClick={() => { setStep('email'); setCode(''); setError(''); setMessage(''); }}>Change email</button>
            </div>
          </form>
        )}

        {message ? <p className="pm-login-message">{message}</p> : null}
        {error ? <p className="pm-login-error" role="alert">{error}</p> : null}
        <small>Your signed-in session is stored securely so Puma can remember you on this device.</small>
      </section>
    </main>
  );
}