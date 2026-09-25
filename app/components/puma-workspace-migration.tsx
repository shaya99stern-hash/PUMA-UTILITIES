'use client';

import { useEffect, useMemo, useState } from 'react';
import { CloudUpload, Database, HardDrive, ShieldCheck } from 'lucide-react';
import { loadWorkspace } from '../../lib/workspace';

type ServerStatus = {
  ok: boolean;
  localImportCompletedAt?: string | null;
  counts?: { companies: number; properties: number; people: number };
  error?: string;
};

type ImportResult = {
  ok: boolean;
  importedAt?: string;
  counts?: Record<string, number>;
  error?: string;
};

export default function PumaWorkspaceMigration() {
  const localWorkspace = useMemo(() => typeof window === 'undefined' ? null : loadWorkspace(), []);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const localCounts = useMemo(() => {
    if (!localWorkspace) return { companies: 0, properties: 0, people: 0 };
    return {
      companies: localWorkspace.companies.length,
      properties: localWorkspace.properties.length,
      people: localWorkspace.companies.reduce((total, company) => total + company.people.length, 0),
    };
  }, [localWorkspace]);

  async function refreshStatus() {
    try {
      const response = await fetch('/api/workspace', { cache: 'no-store' });
      const payload = await response.json() as ServerStatus;
      setServerStatus(payload);
      if (!response.ok) setError(payload.error ?? 'Unable to read server workspace status.');
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Unable to read server workspace status.');
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

  async function importThisDevice() {
    if (!localWorkspace || busy) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/workspace/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(localWorkspace),
      });
      const payload = await response.json() as ImportResult;
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Workspace import failed.');
      const imported = payload.counts ?? {};
      setMessage(`Imported ${imported.companies ?? 0} companies, ${imported.properties ?? 0} properties, and ${imported.people ?? 0} contacts into Supabase. Your browser copy remains on this device as a backup.`);
      await refreshStatus();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Workspace import failed.');
    } finally {
      setBusy(false);
    }
  }

  const importedLabel = serverStatus?.localImportCompletedAt
    ? new Date(serverStatus.localImportCompletedAt).toLocaleString()
    : 'Not imported from this device yet';

  return (
    <section className="pm-workspace-migration">
      <div className="pm-workspace-migration-head">
        <span><CloudUpload size={19} /></span>
        <div>
          <small>Server Workspace</small>
          <strong>Move this device into Supabase</strong>
          <p>Import is explicit and repeat-safe. Puma keeps the existing browser workspace as a rollback copy.</p>
        </div>
      </div>

      <div className="pm-workspace-migration-grid">
        <div>
          <HardDrive size={16} />
          <span><small>This device</small><strong>{localCounts.companies} companies · {localCounts.properties} properties · {localCounts.people} contacts</strong></span>
        </div>
        <div>
          <Database size={16} />
          <span><small>Supabase</small><strong>{serverStatus?.counts ? `${serverStatus.counts.companies} companies · ${serverStatus.counts.properties} properties · ${serverStatus.counts.people} contacts` : 'Checking…'}</strong></span>
        </div>
      </div>

      <div className="pm-workspace-migration-meta">
        <ShieldCheck size={15} />
        <span>Last device import: {importedLabel}</span>
      </div>

      <button type="button" onClick={() => void importThisDevice()} disabled={busy || !localWorkspace}>
        <CloudUpload size={15} /> {busy ? 'Importing…' : 'Import this device'}
      </button>

      {message ? <p className="pm-supabase-message">{message}</p> : null}
      {error ? <p className="pm-supabase-error">{error}</p> : null}
    </section>
  );
}