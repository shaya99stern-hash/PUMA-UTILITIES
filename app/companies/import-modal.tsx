'use client';

import { FileUp, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button, Modal, Textarea, useToast } from '@/app/ui';
import { apiPost, invalidate } from '@/lib/client/api';
import { errMsg } from '@/lib/crm/ui/common';

type ImportResult = {
  ok: boolean; dryRun: boolean; total: number; created: number; existing: number; contacts_created: number; contacts_existing: number; skipped: number;
  mapping: Record<string, string>; skippedRows: Array<{ index: number; reason: string }>;
};

const FIELD_LABEL: Record<string, string> = {
  company: 'Company', website: 'Website', phone: 'Phone', email: 'Email', contact_name: 'Contact name', contact_first: 'First name', contact_last: 'Last name', title: 'Title',
  contact_email: 'Contact email', contact_phone: 'Contact phone', address: 'Address', city: 'City', state: 'State', zip: 'ZIP', units: 'Units', buildings: 'Buildings', stage: 'Stage', type: 'Type', tags: 'Tags',
};

export function ImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone?: () => void }) {
  const toast = useToast();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const reset = () => { setCsv(''); setFileName(''); setPreview(null); };
  const close = () => { if (!busy) { reset(); onClose(); } };

  const load = async (file: File) => {
    setFileName(file.name);
    setPreview(null);
    setCsv(await file.text());
  };

  const run = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const res = await apiPost<ImportResult>('/api/import/companies', { csv, dryRun });
      if (dryRun) setPreview(res);
      else {
        toast.success(`Imported ${res.created} ${res.created === 1 ? 'company' : 'companies'}`, `${res.existing} already existed · ${res.contacts_created} contacts added`);
        void invalidate('/api/companies');
        void invalidate('/api/contacts');
        onDone?.();
        reset();
        onClose();
      }
    } catch (e) { toast.error('Import failed', errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <Modal
      open={open} onClose={close} size="lg" title="Import companies" dismissible={!busy}
      description="Upload a CSV with a header row. Columns like Company, Website, Contact name, Email, City, State, Units and Stage are matched automatically."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
          {preview ? (
            <Button variant="primary" loading={busy} onClick={() => run(false)} disabled={!preview.created && !preview.contacts_created}>
              Import {preview.created} {preview.created === 1 ? 'company' : 'companies'}
            </Button>
          ) : (
            <Button variant="primary" loading={busy} disabled={!csv.trim()} onClick={() => run(true)}>Preview import</Button>
          )}
        </>
      }
    >
      <div className="stack">
        <div
          className="crm-dropzone" data-over={over}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) void load(f); }}
        >
          <FileUp size={22} style={{ margin: '0 auto 8px', color: 'var(--text-3)' }} aria-hidden />
          <p className="strong" style={{ marginBottom: 4 }}>{fileName || 'Drop a CSV file here'}</p>
          <Button size="sm" icon={Upload} onClick={() => input.current?.click()}>Choose file</Button>
          <input ref={input} type="file" accept=".csv,.tsv,.txt,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ''; }} />
        </div>
        <Textarea rows={5} value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); }} placeholder={'…or paste CSV text\nCompany,Website,Contact name,Email\nAcme Residential,acme.com,Jane Doe,jane@acme.com'} spellCheck={false} style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
        {preview && (
          <div className="stack-sm">
            <div className="crm-stats crm-stats--3" style={{ marginBottom: 0 }}>
              <div className="ui-stat"><div className="ui-stat__label">New companies</div><div className="ui-stat__value">{preview.created}</div></div>
              <div className="ui-stat"><div className="ui-stat__label">Already in Puma</div><div className="ui-stat__value">{preview.existing}</div></div>
              <div className="ui-stat"><div className="ui-stat__label">New contacts</div><div className="ui-stat__value">{preview.contacts_created}</div></div>
            </div>
            <p className="section-title" style={{ marginTop: 8 }}>Detected columns</p>
            <div className="crm-importmap">
              {Object.entries(preview.mapping).map(([header, field]) => <div key={header}><b>{header}</b><span>→ {FIELD_LABEL[field] ?? field}</span></div>)}
            </div>
            {preview.skipped > 0 && <p className="text-sm muted">{preview.skipped} {preview.skipped === 1 ? 'row was' : 'rows were'} skipped (no company name).</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}
