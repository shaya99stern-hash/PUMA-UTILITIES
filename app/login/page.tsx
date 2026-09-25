'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { createBrowserSupabase } from '../../lib/supabase-browser';

const REMEMBERED_EMAIL_KEY = 'puma-login-email';

export default function LoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabase(), []);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const remembered = window.localStorage.getItem(REMEMBERED_EMAIL_KEY)?.trim();
    if (remembered) setEmail(remembered);

    const authError = new URLSearchParams(window.location.search).get('auth_error');
    if (authError) setError('That sign-in link could not be completed. Request a fresh link and try again.');

    void supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (data.session) {
        router.replace('/');
        router.refresh();
      }
    });

    const { data } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (session) {
        router.replace('/');
        router.refresh();
      }
    });

    return () => data.subscription.unsubscribe();
  }, [router, supabase]);

  async function sendMagicLink(event?: FormEvent) {
    event?.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;

    setBusy(true);
    setError('');
    setMessage('');

    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: normalized,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: redirectTo,
      },
    });

    setBusy(false);
    if (sendError) {
      setError(sendError.message);
      return;
    }

    window.localStorage.setItem(REMEMBERED_EMAIL_KEY, normalized);
    setEmail(normalized);
    setSent(true);
    setMessage('Open the sign-in email on this device and tap the secure link.');
  }

  return (
    <main className="pm-login-shell">
      <section className="pm-login-card" aria-labelledby="puma-login-title">
        <div className="pm-login-mark">P</div>
        <p className="pm-login-eyebrow">Puma Utilities</p>
        <h1 id="puma-login-title">{sent ? 'Check your email' : 'Sign in'}</h1>
        <p className="pm-login-copy">
          {sent
            ? `We sent a secure sign-in link to ${email}.`
            : 'Enter your email and Puma will send a secure one-time sign-in link.'}
        </p>

        <form className="pm-login-form" onSubmit={sendMagicLink}>
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
            {busy ? 'Sending…' : sent ? 'Resend sign-in link' : 'Send sign-in link'}
          </button>
        </form>

        {sent ? (
          <div className="pm-login-secondary-actions">
            <button type="button" onClick={() => { setSent(false); setError(''); setMessage(''); }}>Use a different email</button>
          </div>
        ) : null}

        {message ? <p className="pm-login-message">{message}</p> : null}
        {error ? <p className="pm-login-error" role="alert">{error}</p> : null}
        <small>The link is single-use. After it opens Puma, your session is stored securely on this device.</small>
      </section>
    </main>
  );
}