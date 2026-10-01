'use client';

import { AlertCircle, ArrowRight, Info, Lock, Mail, UserRound } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Button, Field, Input } from '@/app/ui';
import { BrandMark } from '@/app/ui/brand-mark';
import { supabaseBrowser } from '@/lib/supabase/browser';

type Invite = { valid: boolean; accepted?: boolean; expired?: boolean; email?: string; workspaceName?: string };

function friendlyError(message: string): string {
  if (/PUMA_INVITE_REQUIRED|Database error saving new user/i.test(message)) {
    return "This email hasn't been invited to Puma Utilities yet. Ask a teammate for an invite link — or continue without signing in.";
  }
  if (/Invalid login credentials/i.test(message)) return 'That email and password don’t match. Try again or reset your password.';
  if (/Email not confirmed/i.test(message)) return 'Confirm your email first — check your inbox for the link.';
  if (/Password should be/i.test(message)) return 'Use a password with at least 8 characters.';
  if (/rate limit/i.test(message)) return 'Too many attempts. Wait a minute and try again.';
  if (/already registered/i.test(message)) return 'An account with this email already exists. Sign in instead.';
  return message || 'Something went wrong. Please try again.';
}

const URL_ERRORS: Record<string, string> = {
  missing_code: 'That sign-in link is incomplete. Request a new one.',
  code_exchange_failed: 'That sign-in link has expired. Request a new one.',
};

function safeNext(value: string | null) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

function LoginForm() {
  const params = useSearchParams();
  const router = useRouter();
  const inviteToken = params.get('invite');
  const next = safeNext(params.get('next'));
  const [invite, setInvite] = useState<Invite | null>(null);
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>(inviteToken ? 'signup' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(URL_ERRORS[params.get('auth_error') ?? ''] ?? null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!inviteToken) return;
    fetch(`/api/settings/invite?token=${encodeURIComponent(inviteToken)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { valid: false }))
      .then((data: Invite) => {
        setInvite(data);
        if (data.email) setEmail(data.email);
        if (!data.valid) setMode('signin');
      })
      .catch(() => setInvite({ valid: false }));
  }, [inviteToken]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const supabase = supabaseBrowser();
    try {
      if (mode === 'reset') {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/callback` });
        if (err) throw err;
        setNotice('If that email has an account, a reset link is on its way.');
        return;
      }
      if (mode === 'signup') {
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim() || undefined }, emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (err) throw err;
        if (!data.session) {
          setNotice('Check your email to confirm your account, then sign in.');
          setMode('signin');
          return;
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) throw err;
      }
      router.replace(next);
      router.refresh();
      window.setTimeout(() => window.location.assign(next), 150);
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'signup' ? 'Create your account' : mode === 'reset' ? 'Reset your password' : 'Sign in to Puma';
  const subtitle =
    mode === 'signup'
      ? `You've been invited to ${invite?.workspaceName ?? 'Puma Utilities'}.`
      : mode === 'reset'
        ? 'We’ll email you a link to choose a new password.'
        : 'Signing in is optional — it keeps your profile and sessions in sync across devices.';

  return (
    <div className="auth__panel">
      <div className="auth__brand">
        <BrandMark size={56} />
        <div>
          <h1 className="auth__title">{title}</h1>
          <p className="auth__sub">{subtitle}</p>
        </div>
      </div>

      <form
        className="auth__card"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {inviteToken && invite && !invite.valid && (
          <div className="auth__info" role="status">
            <Info aria-hidden />
            <span>{invite.accepted ? 'This invitation was already used. Sign in with that email.' : invite.expired ? 'This invitation has expired. Ask for a new link.' : 'This invitation link isn’t valid.'}</span>
          </div>
        )}
        {error && (
          <div className="auth__error" role="alert">
            <AlertCircle aria-hidden />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="auth__info" role="status">
            <Info aria-hidden />
            <span>{notice}</span>
          </div>
        )}
        {mode === 'signup' && (
          <Field label="Full name">
            <Input leading={UserRound} value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Rivera" autoComplete="name" />
          </Field>
        )}
        <Field label="Email">
          <Input
            leading={Mail}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
            autoCapitalize="off"
            required
            readOnly={mode === 'signup' && !!invite?.email}
          />
        </Field>
        {mode !== 'reset' && (
          <Field
            label={
              <span className="row-between" style={{ width: '100%' }}>
                Password
                {mode === 'signin' && (
                  <button
                    type="button"
                    className="text-xs subtle"
                    style={{ fontWeight: 500 }}
                    onClick={() => {
                      setMode('reset');
                      setError(null);
                    }}
                  >
                    Forgot?
                  </button>
                )}
              </span>
            }
          >
            <Input
              leading={Lock}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              minLength={mode === 'signup' ? 8 : undefined}
              required
            />
          </Field>
        )}
        <Button type="submit" variant="primary" block loading={busy} disabled={!email.trim() || (mode !== 'reset' && !password)}>
          {mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
        </Button>
        {mode === 'reset' && (
          <div className="auth__switch">
            <button type="button" onClick={() => setMode('signin')}>
              Back to sign in
            </button>
          </div>
        )}
        {mode === 'signup' && (
          <div className="auth__switch">
            Already have an account?{' '}
            <button type="button" onClick={() => setMode('signin')}>
              Sign in
            </button>
          </div>
        )}
        {mode === 'signin' && invite?.valid && (
          <div className="auth__switch">
            New here?{' '}
            <button type="button" onClick={() => setMode('signup')}>
              Accept invitation
            </button>
          </div>
        )}
      </form>

      <div className="auth__divider">or</div>
      <Button block href="/" iconRight={ArrowRight}>
        Continue without signing in
      </Button>
      <p className="auth__foot">New accounts are invite-only. Everything works without an account on this device.</p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="auth">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
