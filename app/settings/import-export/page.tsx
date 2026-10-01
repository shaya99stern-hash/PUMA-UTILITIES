'use client';

import { Building2, Download, FileSpreadsheet, Upload, Users, Warehouse, type LucideIcon } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { Badge, Button, Card, KeyValue, PageHeader, useToast } from '@/app/ui';
import { invalidate } from '@/lib/client/api';

type ImportResult = {
  ok: boolean;
  dryRun: boolean;
  total: number;
  created: number;
  existing: number;
  contacts_created: number;
  contacts_existing: number;
  skipped: number;
  mapping?: Record<string, string>;
};

const EXPORTS: { href: string; title: string; description: string; icon: LucideIcon }[] = [
  { href: '/api/export/companies.csv', title: 'Companies', description: 'Stage, score, portfolio and contact info', icon: Building2 },
  { href: '/api/export/contacts.csv', title: 'Contacts', description: 'People with titles, emails and phones', icon: Users },
  { href: '/api/export/properties.csv', title: 'Properties', description: 'Buildings with units, owners and water estimates', icon: Warehouse },
];

async function postCsv(csv: string, dryRun: boolean): Promise<ImportResult> {
  const res = await fetch('/api/import/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ csv, dryRun }),
  });
  const body = await res.json().catch(() => null);
  if (res.status === 404) throw new Error('CSV import is not available yet.');
  if (!res.ok) throw new Error(body?.error ?? `Import failed (${res.status})`);
  return body as ImportResult;
}

export default function ImportExportPage() {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const [over, setOver] = useState(false);

  const choose = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setPreview(null);
    if (f.size > 8_000_000) {
      setError('That file is larger than 8 MB. Split it into smaller files.');
      return;
    }
    const csv = await f.text();
    setFile({ name: f.name, csv });
    setBusy('preview');
    try {
      setPreview(await postCsv(csv, true));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setBusy(null);
    }
  };

  const runImport = async () => {
    if (!file) return;
    setBusy('import');
    try {
      const result = await postCsv(file.csv, false);
      toast.success(`Imported ${result.created} new ${result.created === 1 ? 'company' : 'companies'}`, `${result.contacts_created} contacts added · ${result.existing} already existed`);
      setFile(null);
      setPreview(null);
      void invalidate('/api/companies');
      void invalidate('/api/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(null);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void choose(e.dataTransfer.files?.[0]);
  };

  const mapped = preview?.mapping ? Object.entries(preview.mapping).filter(([, v]) => v) : [];

  return (
    <div className="page page--narrow">
      <PageHeader title="Import & export" subtitle="Bring in prospect lists or take your data anywhere." back={{ href: '/settings', label: 'Settings' }} />
      <div className="stack">
        <Card title="Import companies" description="CSV with a Company column. Optional: website, phone, address, city, state, contact name, email, title.">
          <div className="stack">
            <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => void choose(e.target.files?.[0] ?? undefined)} />
            <div
              className={`dropzone${over ? ' is-over' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
            >
              {file ? <FileSpreadsheet aria-hidden /> : <Upload aria-hidden />}
              <strong>{file ? file.name : 'Choose a CSV file'}</strong>
              <span className="text-sm subtle">{file ? 'Tap to choose a different file' : 'or drag and drop it here · up to 5,000 rows'}</span>
            </div>
            {error && <p className="ui-field__error">{error}</p>}
            {busy === 'preview' && <p className="text-sm muted">Checking your file…</p>}
            {preview && (
              <div className="stack-sm">
                <KeyValue
                  items={[
                    { label: 'Rows', value: preview.total.toLocaleString() },
                    { label: 'New companies', value: preview.created.toLocaleString() },
                    { label: 'Already in CRM', value: preview.existing.toLocaleString() },
                    { label: 'New contacts', value: preview.contacts_created.toLocaleString() },
                    { label: 'Skipped rows', value: preview.skipped ? preview.skipped.toLocaleString() : '0' },
                  ]}
                />
                {mapped.length > 0 && (
                  <div className="row-wrap" style={{ gap: 6 }}>
                    <span className="text-xs subtle">Columns:</span>
                    {mapped.map(([col, field]) => (
                      <Badge key={col} outline>
                        {col} → {field}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="settings-actions">
                  <Button
                    onClick={() => {
                      setFile(null);
                      setPreview(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button variant="primary" icon={Upload} loading={busy === 'import'} disabled={!preview.created && !preview.contacts_created} onClick={() => void runImport()}>
                    Import {preview.created.toLocaleString()} {preview.created === 1 ? 'company' : 'companies'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card title="Export" description="Download CSV files you can open in Excel or Google Sheets." flush>
          <ul className="ui-list">
            {EXPORTS.map((x) => {
              const Icon = x.icon;
              return (
                <li key={x.href} className="ui-list__item">
                  <span className="settings-icon">
                    <Icon aria-hidden />
                  </span>
                  <div className="ui-list__main">
                    <span className="ui-list__title">{x.title}</span>
                    <span className="ui-list__sub">{x.description}</span>
                  </div>
                  <Button size="sm" icon={Download} href={x.href}>
                    CSV
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}
