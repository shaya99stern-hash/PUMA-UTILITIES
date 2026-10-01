'use client';

import './crm.css';
import { Pencil, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, Button, Chip, Input, Modal, Select, Skeleton, STAGES } from '@/app/ui';
import { apiGet } from '@/lib/client/api';
import { EMAIL_STATUSES, type EmailStatus } from '../types';

export function errMsg(e: unknown, fallback = 'Something went wrong.'): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Current local IANA time zone (for due-date bucketing on the server). */
export function localTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'; } catch { return 'America/New_York'; }
}

/* ------------------------------------------------------------------------- */

export function StageStepper({ stage, onChange, disabled }: { stage: string; onChange: (stage: string) => void; disabled?: boolean }) {
  const idx = STAGES.findIndex((s) => s.key === stage);
  return (
    <div>
      <div className="crm-stepper" aria-hidden>
        {STAGES.filter((s) => s.key !== 'lost').map((s, i) => (
          <span key={s.key} className="crm-stepper__seg" style={{ background: stage !== 'lost' && i <= idx ? s.color : undefined }} />
        ))}
      </div>
      <div className="crm-stagegrid" role="group" aria-label="Pipeline stage">
        {STAGES.map((s) => (
          <button key={s.key} type="button" className="crm-stagebtn" aria-pressed={stage === s.key} disabled={disabled} onClick={() => stage !== s.key && onChange(s.key)} title={s.description}>
            <i style={{ background: s.color }} />
            {s.label === 'New lead' ? 'New' : s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const EMAIL_TONE: Record<EmailStatus, 'success' | 'info' | 'warning' | 'neutral' | 'danger'> = {
  verified: 'success', published: 'info', inferred: 'warning', unknown: 'neutral', bounced: 'danger',
};
export function EmailStatusBadge({ status }: { status: EmailStatus | string | null | undefined }) {
  if (!status) return null;
  const s = (EMAIL_STATUSES as readonly string[]).includes(status) ? (status as EmailStatus) : 'unknown';
  const hint: Record<EmailStatus, string> = {
    verified: 'Verified deliverable', published: 'Published on the company site or public record', inferred: 'Inferred from a common pattern, not confirmed',
    unknown: 'Not verified', bounced: 'Bounced; do not send',
  };
  return <Badge tone={EMAIL_TONE[s]} title={hint[s]}>{s}</Badge>;
}

/* ------------------------------------------------------------------------- */

export type InlineEditProps = {
  label: string;
  value: string | number | null | undefined;
  display?: ReactNode;
  type?: 'text' | 'number' | 'money' | 'select' | 'url' | 'email' | 'tel';
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  onSave: (value: string) => Promise<unknown>;
};

export function InlineEdit({ label, value, display, type = 'text', options, placeholder, onSave }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement | HTMLSelectElement>(null);
  const current = value === null || value === undefined ? '' : String(value);

  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  const start = () => { setDraft(current); setEditing(true); };
  const commit = async (next = draft) => {
    if (next.trim() === current.trim()) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(next.trim()); setEditing(false); } catch { /* caller toasts; keep editing */ } finally { setSaving(false); }
  };
  const inputType = type === 'money' || type === 'number' ? 'text' : type;

  return (
    <div className="crm-inline">
      <span className="crm-inline__label">{label}</span>
      {editing ? (
        <div className="crm-inline__edit">
          {type === 'select' ? (
            <Select ref={ref as never} value={draft} options={options} disabled={saving} onChange={(e) => { setDraft(e.target.value); void commit(e.target.value); }} onBlur={() => setEditing(false)} />
          ) : (
            <Input
              ref={ref as never}
              type={inputType}
              inputMode={type === 'number' || type === 'money' ? 'decimal' : undefined}
              value={draft}
              placeholder={placeholder}
              disabled={saving}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void commit()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void commit(); }
                if (e.key === 'Escape') setEditing(false);
              }}
            />
          )}
        </div>
      ) : (
        <button type="button" className={`crm-inline__value${current ? '' : ' crm-inline__value--empty'}`} onClick={start} aria-label={`Edit ${label}`}>
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{current ? display ?? current : placeholder ?? 'Add'}</span>
          <Pencil aria-hidden />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- */

export function TagsEditor({ tags, onChange, disabled }: { tags: string[]; onChange: (tags: string[]) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const parts = draft.split(/[,;]/).map((t) => t.trim()).filter(Boolean);
    if (!parts.length) return;
    onChange([...new Set([...tags, ...parts])]);
    setDraft('');
  };
  return (
    <div className="crm-tagsedit">
      {tags.map((t) => <Chip key={t} selected onRemove={disabled ? undefined : () => onChange(tags.filter((x) => x !== t))}>{t}</Chip>)}
      {!disabled && (
        <Input
          size="sm" placeholder={tags.length ? 'Add tag' : 'Add tags (comma separated)'} value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1)); }}
          onBlur={add}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- */

export type PickerOption = { id: string; label: string; sub?: string | null };

/** Async search-as-you-type picker for a linked record (company, contact, property). */
export function EntityPicker({ value, onChange, source, placeholder = 'Search…', disabled }: {
  value: PickerOption | null;
  onChange: (value: PickerOption | null) => void;
  /** Fetch options for a query. */
  source: (q: string) => Promise<PickerOption[]>;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PickerOption[]>([]);
  const dq = useDebounced(q, 200);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    source(dq).then((r) => { if (alive) setItems(r); }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq, open]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  if (value) {
    return (
      <div className="crm-picked">
        <span>{value.label}</span>
        {!disabled && <button type="button" className="ui-iconbtn ui-iconbtn--sm" aria-label="Clear" onClick={() => onChange(null)}><X size={14} /></button>}
      </div>
    );
  }
  return (
    <div className="crm-picker" ref={wrap}>
      <Input value={q} placeholder={placeholder} disabled={disabled} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {open && (
        <div className="crm-picker__list" role="listbox">
          {items.length === 0 ? (
            <div className="crm-picker__item subtle" style={{ cursor: 'default' }}>{dq ? 'No matches' : 'Start typing to search'}</div>
          ) : items.map((o) => (
            <button key={o.id} type="button" className="crm-picker__item" role="option" aria-selected={false} onClick={() => { onChange(o); setOpen(false); setQ(''); }}>
              <span>{o.label}</span>
              {o.sub && <span className="crm-picker__sub">{o.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const companySource = async (q: string): Promise<PickerOption[]> => {
  const r = await apiGet<{ rows: Array<{ id: string; name: string; city: string | null; state: string | null }> }>(`/api/companies?limit=8&sort=${q ? 'name' : 'last_activity'}&q=${encodeURIComponent(q)}`);
  return r.rows.map((c) => ({ id: c.id, label: c.name, sub: [c.city, c.state].filter(Boolean).join(', ') || null }));
};
export const contactSource = (companyId?: string | null) => async (q: string): Promise<PickerOption[]> => {
  const r = await apiGet<{ rows: Array<{ id: string; full_name: string; title: string | null; company_name: string | null }> }>(`/api/contacts?limit=8&q=${encodeURIComponent(q)}${companyId ? `&companyId=${companyId}` : ''}`);
  return r.rows.map((c) => ({ id: c.id, label: c.full_name, sub: [c.title, c.company_name].filter(Boolean).join(' · ') || null }));
};
export const propertySource = (companyId?: string | null) => async (q: string): Promise<PickerOption[]> => {
  const r = await apiGet<{ rows: Array<{ id: string; name: string | null; address: string; city: string | null; company_name: string | null }> }>(`/api/properties?limit=8&q=${encodeURIComponent(q)}${companyId ? `&companyId=${companyId}` : ''}`);
  return r.rows.map((p) => ({ id: p.id, label: p.name || p.address, sub: [p.name ? p.address : null, p.city, p.company_name].filter(Boolean).join(' · ') || null }));
};

/* ------------------------------------------------------------------------- */

export function ConfirmModal({ open, title, description, confirmLabel = 'Delete', danger = true, onConfirm, onClose }: {
  open: boolean; title: string; description?: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<unknown> | unknown; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open} onClose={() => !busy && onClose()} title={title} description={description} size="sm" dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } finally { setBusy(false); } }}>{confirmLabel}</Button>
        </>
      }
    />
  );
}

/* ------------------------------------------------------------------------- */

export function RowsSkeleton({ rows = 6, avatar = true }: { rows?: number; avatar?: boolean }) {
  return (
    <div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="crm-skel-row">
          {avatar && <Skeleton width={34} height={34} radius={9} />}
          <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <Skeleton width={`${48 + ((i * 13) % 30)}%`} height={13} />
            <Skeleton width={`${30 + ((i * 7) % 25)}%`} height={10} />
          </div>
          <Skeleton width={60} height={22} radius={11} />
        </div>
      ))}
    </div>
  );
}

export function Pager({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (offset: number) => void }) {
  if (total <= limit) return total ? <div className="crm-pager"><span>{total} {total === 1 ? 'result' : 'results'}</span></div> : null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className="crm-pager">
      <span className="num">{from}–{to} of {total.toLocaleString()}</span>
      <div className="row">
        <Button size="sm" variant="secondary" disabled={offset <= 0} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</Button>
        <Button size="sm" variant="secondary" disabled={to >= total} onClick={() => onChange(offset + limit)}>Next</Button>
      </div>
    </div>
  );
}

