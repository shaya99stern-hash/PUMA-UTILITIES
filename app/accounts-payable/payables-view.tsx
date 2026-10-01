'use client';

import { CheckCircle2, MoreHorizontal, Pencil, Plus, Receipt, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, Button, DataTable, EmptyState, Field, FilterChips, IconButton, Input, Menu, PageHeader, SearchInput, Select, Sheet, Stat, Textarea, useToast, type DataTableColumn } from '@/app/ui';
import { apiDelete, apiPatch, apiPost, invalidate, useApi } from '@/lib/client/api';
import { fmtDate, fmtMoney } from '@/lib/crm/format';
import { PAYABLE_STATUSES, type PayableListRow, type PayableStatus } from '@/lib/crm/types';
import { companySource, ConfirmModal, EntityPicker, errMsg, propertySource, type PickerOption } from '@/lib/crm/ui/common';

type Resp = { rows: PayableListRow[]; summary: { outstanding: number; paid: number; overdue_count: number; overdue_amount: number; due_count: number; draft: number } };
const TONE: Record<PayableStatus, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = { draft: 'neutral', due: 'info', paid: 'success', overdue: 'danger', void: 'neutral' };

export function PayablesView() {
  const toast = useToast();
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const { data, error, isLoading, mutate } = useApi<Resp>(`/api/payables?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  const [sheet, setSheet] = useState<{ open: boolean; row?: PayableListRow | null }>({ open: false });
  const [deleting, setDeleting] = useState<PayableListRow | null>(null);
  const s = data?.summary;

  const setPayStatus = async (row: PayableListRow, next: PayableStatus) => {
    try { await apiPatch(`/api/payables/${row.id}`, { status: next }); toast.success(next === 'paid' ? 'Marked as paid' : 'Status updated'); await mutate(); } catch (e) { toast.error('Could not update', errMsg(e)); }
  };
  const remove = async (row: PayableListRow) => {
    try { await apiDelete(`/api/payables/${row.id}`); toast.success('Deleted'); await mutate(); } catch (e) { toast.error('Could not delete', errMsg(e)); throw e; }
  };
  const menu = (row: PayableListRow) => (
    <Menu trigger={<IconButton size="sm" icon={MoreHorizontal} label="Actions" />} items={[
      ...(row.effective_status !== 'paid' ? [{ label: 'Mark as paid', icon: CheckCircle2, onSelect: () => void setPayStatus(row, 'paid') }] : [{ label: 'Mark as due', icon: Receipt, onSelect: () => void setPayStatus(row, 'due') }]),
      { label: 'Edit', icon: Pencil, onSelect: () => setSheet({ open: true, row }) },
      { separator: true as const },
      { label: 'Delete', icon: Trash2, danger: true, onSelect: () => setDeleting(row) },
    ]} />
  );

  const columns: DataTableColumn<PayableListRow>[] = [
    { key: 'description', header: 'Description', mobile: 'title', cell: (r) => <div className="crm-namecell__text"><span className="crm-namecell__name">{r.description}</span>{r.property_name && <span className="crm-namecell__sub">{r.property_name}</span>}</div> },
    { key: 'company', header: 'Client', cell: (r) => r.company_id ? <Link href={`/companies/${r.company_id}`} style={{ color: 'inherit' }}>{r.company_name}</Link> : <span className="subtle">—</span> },
    { key: 'due', header: 'Due', cell: (r) => <span className={r.effective_status === 'overdue' ? 'crm-overdue' : undefined}>{r.due_date ? fmtDate(r.due_date) : '—'}</span> },
    { key: 'status', header: 'Status', cell: (r) => <Badge tone={TONE[r.effective_status]} dot>{r.effective_status}</Badge> },
    { key: 'amount', header: 'Amount', align: 'right', cell: (r) => <span className="num strong">{fmtMoney(r.amount, { cents: r.amount % 1 !== 0 })}</span> },
    { key: 'actions', header: '', width: 48, align: 'right', mobile: 'hidden', cell: menu },
  ];
  const mobileCard = (r: PayableListRow) => (
    <div className="crm-card">
      <div className="crm-card__top"><div className="grow"><div className="crm-namecell__name" style={{ whiteSpace: 'normal' }}>{r.description}</div><div className="crm-namecell__sub">{[r.company_name, r.property_name].filter(Boolean).join(' · ') || 'No client'}</div></div><span data-no-row-click>{menu(r)}</span></div>
      <div className="row-between"><Badge tone={TONE[r.effective_status]} dot>{r.effective_status}</Badge><span className="strong num">{fmtMoney(r.amount, { cents: r.amount % 1 !== 0 })}</span></div>
      <div className={`text-sm ${r.effective_status === 'overdue' ? 'crm-overdue' : 'subtle'}`}>{r.due_date ? `Due ${fmtDate(r.due_date)}` : 'No due date'}</div>
    </div>
  );

  const empty = !isLoading && !error && data && data.rows.length === 0;
  const noneAtAll = empty && status === 'all' && !q;
  return (
    <div className="page">
      <PageHeader title="Accounts payable" subtitle="Invoices and billing items for your clients" actions={<Button variant="primary" icon={Plus} onClick={() => setSheet({ open: true })}>Add item</Button>} />
      <div className="crm-stats">
        <Stat label="Outstanding" value={fmtMoney(s?.outstanding ?? 0)} tone="accent" hint={s ? `${s.due_count} open` : undefined} />
        <Stat label="Overdue" value={s?.overdue_count ?? 0} tone={s?.overdue_count ? 'danger' : 'default'} hint={s?.overdue_count ? fmtMoney(s.overdue_amount) : 'All current'} />
        <Stat label="Paid" value={fmtMoney(s?.paid ?? 0)} tone="success" />
        <Stat label="Drafts" value={fmtMoney(s?.draft ?? 0)} />
      </div>
      <div className="crm-toolbar">
        <SearchInput className="crm-toolbar__search" value={q} debounce={250} onChange={setQ} placeholder="Search description or client" />
        <div className="crm-filters crm-filters--scroll"><FilterChips aria-label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, { value: 'due', label: 'Due' }, { value: 'overdue', label: 'Overdue' }, { value: 'paid', label: 'Paid' }, { value: 'draft', label: 'Draft' }]} /></div>
      </div>
      {error && !data ? <EmptyState bordered icon={Receipt} title="Couldn't load payables" description={errMsg(error)} actions={<Button onClick={() => void mutate()}>Try again</Button>} />
        : noneAtAll ? <EmptyState bordered icon={Receipt} title="No billing items yet" description="Track installation deposits, hardware and monitoring subscriptions for each client." actions={<Button variant="primary" icon={Plus} onClick={() => setSheet({ open: true })}>Add item</Button>} />
        : empty ? <EmptyState bordered icon={Receipt} title="No items match" description="Try another status or search." actions={<Button onClick={() => { setStatus('all'); setQ(''); }}>Clear filters</Button>} />
        : <DataTable aria-label="Payables" rows={data?.rows ?? []} columns={columns} getRowId={(r) => r.id} loading={isLoading && !data} mobileCard={mobileCard} onRowClick={(r) => setSheet({ open: true, row: r })} />}
      <PayableSheet open={sheet.open} row={sheet.row} onClose={() => setSheet({ open: false })} onSaved={() => void mutate()} />
      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} title="Delete this item?" description={deleting ? `${deleting.description} (${fmtMoney(deleting.amount)})` : undefined} onConfirm={() => remove(deleting!)} />
    </div>
  );
}

function PayableSheet({ open, row, onClose, onSaved }: { open: boolean; row?: PayableListRow | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ description: '', amount: '', status: 'due', due_date: '', notes: '' });
  const [company, setCompany] = useState<PickerOption | null>(null);
  const [property, setProperty] = useState<PickerOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setF({ description: row?.description ?? '', amount: row ? String(row.amount) : '', status: row?.status ?? 'due', due_date: row?.due_date ? String(row.due_date).slice(0, 10) : '', notes: row?.notes ?? '' });
    setCompany(row?.company_id ? { id: row.company_id, label: row.company_name ?? 'Client' } : null);
    setProperty(row?.property_id ? { id: row.property_id, label: row.property_name ?? 'Property' } : null);
  }, [open, row]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!f.description.trim()) errs.description = 'Describe the item.';
    const amount = Number(f.amount.replace(/[$,\s]/g, ''));
    if (!f.amount.trim() || !Number.isFinite(amount) || amount < 0) errs.amount = 'Enter a valid amount.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const body = { description: f.description.trim(), amount, status: f.status, due_date: f.due_date || null, notes: f.notes.trim() || null, company_id: company?.id ?? null, property_id: property?.id ?? null };
      if (row) await apiPatch(`/api/payables/${row.id}`, body); else await apiPost('/api/payables', body);
      toast.success(row ? 'Item updated' : 'Item added');
      void invalidate('/api/payables');
      onSaved(); onClose();
    } catch (e) { toast.error('Could not save', errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} size="sm" title={row ? 'Edit billing item' : 'Add billing item'} full
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>{row ? 'Save changes' : 'Add item'}</Button></>}>
      <div className="stack">
        <Field label="Description" required error={errors.description}><Input value={f.description} onChange={set('description')} autoFocus placeholder="Installation deposit (50%)" invalid={!!errors.description} /></Field>
        <div className="crm-formgrid crm-formgrid--2">
          <Field label="Amount" required error={errors.amount}><Input value={f.amount} onChange={set('amount')} inputMode="decimal" placeholder="$0.00" invalid={!!errors.amount} /></Field>
          <Field label="Status"><Select value={f.status} onChange={set('status')} options={PAYABLE_STATUSES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))} /></Field>
          <Field label="Due date"><Input type="date" value={f.due_date} onChange={set('due_date')} /></Field>
        </div>
        <Field label="Client"><EntityPicker value={company} onChange={(v) => { setCompany(v); setProperty(null); }} source={companySource} placeholder="Search clients…" /></Field>
        <Field label="Property"><EntityPicker key={company?.id ?? 'any'} value={property} onChange={setProperty} source={propertySource(company?.id)} placeholder="Link a building (optional)" /></Field>
        <Field label="Notes"><Textarea value={f.notes} onChange={set('notes')} rows={3} /></Field>
      </div>
    </Sheet>
  );
}
