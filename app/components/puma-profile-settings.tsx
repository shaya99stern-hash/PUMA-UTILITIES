'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

const PROFILE_KEY = 'puma-profile-name';

type AccountStatus = { ok?: boolean; portable?: boolean; email?: string | null };

export default function PumaProfileSettings() {
  const [savedName, setSavedName] = useState('');
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState(false);
  const [accountEmail, setAccountEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accountStatus, setAccountStatus] = useState('Checking account…');
  const [portable, setPortable] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(PROFILE_KEY)?.trim() ?? '';
    setSavedName(stored);
    setDraft(stored);
    void fetch('/api/account/status', { cache: 'no-store' })
      .then((response) => response.json())
      .then((body: AccountStatus) => {
        if (body.portable && body.email) {
          setPortable(true);
          setAccountEmail(body.email);
          setAccountStatus(`Signed in as ${body.email}`);
        } else {
          setPortable(false);
          setAccountStatus('This device is private and works without sign-in. Add an email to use the same Puma workspace on another device.');
        }
      })
      .catch(() => setAccountStatus('Account status is temporarily unavailable.'));
  }, []);

  const normalizedDraft = draft.trim();
  const changed = normalizedDraft !== savedName;

  const save = () => {
    if (!changed) return;
    if (normalizedDraft) window.localStorage.setItem(PROFILE_KEY, normalizedDraft);
    else window.localStorage.removeItem(PROFILE_KEY);
    setSavedName(normalizedDraft);
    setDraft(normalizedDraft);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
  };

  const claimAccount = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setAccountStatus('Saving account email…');
    try {
      const response = await fetch('/api/account/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: accountEmail, password }),
      });
      const body = await response.json() as { ok?: boolean; error?: string; message?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || 'Unable to save account email.');
      setPortable(true);
      setPassword('');
      setAccountStatus(body.message || `Account email saved as ${accountEmail}.`);
    } catch (error) {
      setAccountStatus(error instanceof Error ? error.message : 'Unable to save account email.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="pm-profile-settings pm-profile-settings-page">
      <label>
        <span>Display name</span>
        <input
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setSaved(false); }}
          placeholder="Your name"
          autoComplete="name"
        />
      </label>
      <button type="button" onClick={save} disabled={!changed}>{saved ? 'Saved' : 'Save'}</button>
      <small>{savedName ? `Home will greet you as ${savedName}.` : 'Leave blank for a simple “Welcome”.'}</small>

      <div style={{ height: 1, background: 'rgba(255,255,255,.08)', margin: '12px 0' }} />

      <form onSubmit={claimAccount} style={{ display: 'grid', gap: 10 }}>
        <strong>Account email</strong>
        <small>{accountStatus}</small>
        <label>
          <span>Email</span>
          <input type="email" autoComplete="email" required value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} placeholder="you@company.com" />
        </label>
        <label>
          <span>{portable ? 'New password (only if changing)' : 'Password'}</span>
          <input type="password" autoComplete="new-password" required={!portable} minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8+ characters" />
        </label>
        <button type="submit" disabled={busy || !accountEmail.trim() || (!portable && password.length < 8)}>{busy ? 'Saving…' : portable ? 'Update account' : 'Use Puma on another device'}</button>
        <small>Email sign-in is optional. Your current device continues working even if you never create an account.</small>
        <Link href="/login" style={{ color: '#ff762c', fontSize: 12 }}>Sign in with an existing Puma email</Link>
      </form>
    </section>
  );
}
