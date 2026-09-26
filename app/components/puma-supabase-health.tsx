'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, DatabaseZap, RefreshCw, RotateCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { createBrowserSupabase } from '../../lib/supabase-browser';

type HealthPayload = {
  ok: boolean;
  project?: string;
  region?: string;
  database?: string;
  auth?: string;
  authenticatedEmail?: string | null;
  latencyMs?: number;
  checkedAt?: string;
  error?: string;
};

type Phase = 'idle' | 'checking' | 'healthy' | 'error';

export default function PumaSupabaseHealth() {
  const supabase = useMemo(() => createBrowserSupabase(), []);
  const [phase, setPhase] = useState<Phase>('idle');
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [message, setMessage] = useState('');

  async function checkHealth() {
    setPhase('checking');
    setMessage('');
    try {
      const response = await fetch('/api/system/supabase-health', { cache: 'no-store' });
      const payload = await response.json() as HealthPayload;
      setHealth(payload);
      setPhase(response.ok && payload.ok ? 'healthy' : 'error');
      if (!response.ok) setMessage(payload.error ?? 'Puma could not reach Supabase.');
      return response.ok && payload.ok;
    } catch (error) {
      setHealth(null);
      setPhase('error');
      setMessage(error instanceof Error ? error.message : 'Puma could not reach Supabase.');
      return false;
    }
  }

  async function reconnect() {
    setPhase('checking');
    setMessage('Refreshing your authenticated Supabase connection…');
    const { error } = await supabase.auth.refreshSession();
    if (error) {
      setPhase('error');
      setMessage(`Session refresh failed: ${error.message}`);
      return;
    }
    const healthy = await checkHealth();
    setMessage(healthy
      ? 'Supabase connection refreshed and verified.'
      : 'Session refreshed, but the database health check still needs attention.');
  }

  useEffect(() => {
    void checkHealth();
  }, []);

  const checkedLabel = health?.checkedAt
    ? new Date(health.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
    : 'Not checked yet';

  return (
    <div className="pm-supabase-health">
      <section className={`pm-supabase-status-card ${phase}`}>
        <div className="pm-supabase-status-head">
          <span className="pm-supabase-status-icon">
            {phase === 'healthy' ? <CheckCircle2 size={21} /> : phase === 'error' ? <TriangleAlert size={21} /> : <DatabaseZap size={21} />}
          </span>
          <span>
            <small>Backend status</small>
            <strong>{phase === 'healthy' ? 'Supabase is healthy' : phase === 'checking' ? 'Checking Supabase…' : phase === 'error' ? 'Connection needs attention' : 'Supabase'}</strong>
          </span>
        </div>
        <div className="pm-supabase-metrics">
          <div><small>Database</small><strong>{health?.database ?? '—'}</strong></div>
          <div><small>Authentication</small><strong>{health?.auth ?? '—'}</strong></div>
          <div><small>Latency</small><strong>{typeof health?.latencyMs === 'number' ? `${health.latencyMs} ms` : '—'}</strong></div>
          <div><small>Region</small><strong>{health?.region ?? 'us-east-1'}</strong></div>
        </div>
        <p className="pm-supabase-checked">Last checked: {checkedLabel}</p>
      </section>

      <section className="pm-supabase-actions-card">
        <div>
          <ShieldCheck size={18} />
          <span>
            <strong>Puma Utilities database</strong>
            <small>Tests authentication, workspace access, RLS-protected database reads, and response latency.</small>
          </span>
        </div>
        <div className="pm-supabase-buttons">
          <button type="button" onClick={() => void checkHealth()} disabled={phase === 'checking'}>
            <RefreshCw size={15} /> Test connection
          </button>
          <button type="button" onClick={() => void reconnect()} disabled={phase === 'checking'}>
            <RotateCw size={15} /> Reconnect Supabase
          </button>
        </div>
        <small className="pm-supabase-recovery-note">
          Reconnect refreshes Puma’s secure session and verifies the database again. It does not power-cycle Supabase infrastructure.
        </small>
        {health?.authenticatedEmail ? <small className="pm-supabase-user">Signed in as {health.authenticatedEmail}</small> : null}
        {message ? <p className={phase === 'error' ? 'pm-supabase-error' : 'pm-supabase-message'}>{message}</p> : null}
      </section>
    </div>
  );
}