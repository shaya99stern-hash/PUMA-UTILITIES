'use client';

import './crm.css';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Field, Input, Select, Sheet, Textarea, useToast } from '@/app/ui';
import { apiPatch, apiPost, ClientApiError, invalidate } from '@/lib/client/api';
import { toLocalInput } from '../format';
import {
  COMPANY_TYPES, COMPANY_TYPE_LABELS, METER_STATUSES, ROLE_CATEGORIES, ROLE_LABELS, STAGES as STAGE_KEYS, STAGE_LABELS, TASK_PRIORITIES, TASK_TYPES, TASK_TYPE_LABELS,
  type CompanyRow, type ContactRow, type PropertyRow, type TaskRow,
} from '../types';
import { companySource, EntityPicker, errMsg, TagsEditor, type PickerOption } from './common';

function SheetForm({ open, onClose, title, description, submitLabel, busy, onSubmit, children, size = 'md' }: {
  open: boolean; onClose: () => void; title: string; description?: string; submitLabel: string; busy: boolean; onSubmit: () => void; children: ReactNode; size?: 'sm' | 'md' | 'lg';
}) {
  const submit = (e: FormEvent) => { e.preventDefault(); onSubmit(); };
  return (
    <Sheet
      open={open} onClose={onClose} title={title} description={description} size={size} full
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={onSubmit}>{submitLabel}</Button></>}
    >
      <form onSubmit={submit} className="stack" noValidate>
        {children}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const nn = (v: string) => (v.trim() === '' ? null : v.trim());
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[$,\s]/g, '')));

/* ------------------------------------------------------------------------- */

export function CompanySheet({ open, onClose, company, onSaved, defaults }: {
  open: boolean; onClose: () => void; company?: CompanyRow | null; onSaved?: (company: CompanyRow) => void; defaults?: Partial<Record<string, string>>;
}) {
  const toast = useToast();
  const router = useRouter();
  const editing = !!company;
  const [f, setF] = useState({ name: '', website: '', phone: '', email: '', address: '', city: '', state: '', zip: '', company_type: 'unknown', stage: 'new', portfolio_buildings: '', portfolio_units: '', est_annual_water_spend: '', description: '' });
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setTags(company?.tags ?? []);
    setF({
      name: s(company?.name ?? defaults?.name), website: s(company?.website ?? defaults?.website), phone: s(company?.phone), email: s(company?.email), address: s(company?.address),
      city: s(company?.city), state: s(company?.state), zip: s(company?.zip), company_type: s(company?.company_type ?? 'unknown'), stage: s(company?.stage ?? 'new'),
      portfolio_buildings: s(company?.portfolio_buildings), portfolio_units: s(company?.portfolio_units), est_annual_water_spend: s(company?.est_annual_water_spend), description: s(company?.description),
    });
  }, [open, company, defaults]);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    if (!f.name.trim()) { setErrors({ name: 'Company name is required.' }); return; }
    setBusy(true);
    try {
      const body = {
        name: f.name.trim(), website: nn(f.website), phone: nn(f.phone), email: nn(f.email), address: nn(f.address), city: nn(f.city), state: nn(f.state), zip: nn(f.zip),
        company_type: f.company_type, portfolio_buildings: numOrNull(f.portfolio_buildings), portfolio_units: numOrNull(f.portfolio_units),
        est_annual_water_spend: numOrNull(f.est_annual_water_spend), description: nn(f.description), tags,
        ...(editing ? {} : { stage: f.stage }),
      };
      const res = editing
        ? await apiPatch<{ company: CompanyRow }>(`/api/companies/${company!.id}`, body)
        : await apiPost<{ company: CompanyRow }>('/api/companies', body);
      toast.success(editing ? 'Company updated' : `${res.company.name} added`);
      void invalidate('/api/companies');
      void invalidate('/api/dashboard');
      onSaved?.(res.company);
      onClose();
    } catch (e) {
      if (e instanceof ClientApiError && e.status === 409) {
        const id = (e.details as { existingId?: string } | undefined)?.existingId;
        toast.toast({ title: e.message, tone: 'warning', action: id ? { label: 'Open', onClick: () => router.push(`/companies/${id}`) } : undefined });
      } else if (e instanceof ClientApiError && e.status === 400 && /email/i.test(e.message)) setErrors({ email: e.message });
      else toast.error('Could not save company', errMsg(e));
    } finally { setBusy(false); }
  };

  return (
    <SheetForm open={open} onClose={onClose} title={editing ? 'Edit company' : 'Add company'} description={editing ? undefined : 'Owners and property managers of multifamily buildings.'} submitLabel={editing ? 'Save changes' : 'Add company'} busy={busy} onSubmit={submit} size="md">
      <Field label="Company name" required error={errors.name}><Input value={f.name} onChange={set('name')} autoFocus={!editing} placeholder="Acme Residential Group" invalid={!!errors.name} /></Field>
      <div className="crm-formgrid crm-formgrid--2">
        <Field label="Website"><Input value={f.website} onChange={set('website')} placeholder="acmeresidential.com" inputMode="url" autoCapitalize="none" /></Field>
        <Field label="Main phone"><Input value={f.phone} onChange={set('phone')} placeholder="(201) 555-0100" inputMode="tel" /></Field>
        <Field label="General email" error={errors.email}><Input type="email" value={f.email} onChange={set('email')} placeholder="info@acme.com" autoCapitalize="none" invalid={!!errors.email} /></Field>
        <Field label="Company type"><Select value={f.company_type} onChange={set('company_type')} options={COMPANY_TYPES.map((t) => ({ value: t, label: COMPANY_TYPE_LABELS[t] }))} /></Field>
        {!editing && <Field label="Stage"><Select value={f.stage} onChange={set('stage')} options={STAGE_KEYS.map((t) => ({ value: t, label: STAGE_LABELS[t] }))} /></Field>}
      </div>
      <Field label="Address"><Input value={f.address} onChange={set('address')} placeholder="100 Main St" /></Field>
      <div className="crm-formgrid crm-formgrid--3">
        <Field label="City"><Input value={f.city} onChange={set('city')} /></Field>
        <Field label="State"><Input value={f.state} onChange={set('state')} maxLength={2} placeholder="NJ" autoCapitalize="characters" /></Field>
        <Field label="ZIP"><Input value={f.zip} onChange={set('zip')} inputMode="numeric" /></Field>
      </div>
      <div className="crm-formgrid crm-formgrid--3">
        <Field label="Buildings"><Input value={f.portfolio_buildings} onChange={set('portfolio_buildings')} inputMode="numeric" /></Field>
        <Field label="Units"><Input value={f.portfolio_units} onChange={set('portfolio_units')} inputMode="numeric" /></Field>
        <Field label="Est. water spend / yr"><Input value={f.est_annual_water_spend} onChange={set('est_annual_water_spend')} inputMode="decimal" placeholder="$" /></Field>
      </div>
      <Field label="Tags"><TagsEditor tags={tags} onChange={setTags} /></Field>
      <Field label="Description"><Textarea value={f.description} onChange={set('description')} rows={3} /></Field>
    </SheetForm>
  );
}

/* ------------------------------------------------------------------------- */

export function ContactSheet({ open, onClose, contact, companyId, companyName, onSaved }: {
  open: boolean; onClose: () => void; contact?: ContactRow | null; companyId?: string | null; companyName?: string | null; onSaved?: (contact: ContactRow) => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const editing = !!contact;
  const [f, setF] = useState({ full_name: '', title: '', role_category: 'other', email: '', phone: '', mobile: '', linkedin_url: '', notes: '' });
  const [dm, setDm] = useState(false);
  const [company, setCompany] = useState<PickerOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setDm(contact?.is_decision_maker ?? false);
    setF({ full_name: s(contact?.full_name), title: s(contact?.title), role_category: s(contact?.role_category ?? 'other'), email: s(contact?.email), phone: s(contact?.phone), mobile: s(contact?.mobile), linkedin_url: s(contact?.linkedin_url), notes: s(contact?.notes) });
    setCompany(companyId ? { id: companyId, label: companyName ?? 'Company' } : null);
  }, [open, contact, companyId, companyName]);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    if (!f.full_name.trim() && !f.email.trim()) { setErrors({ full_name: 'Enter a name or email.' }); return; }
    setBusy(true);
    try {
      const body = {
        full_name: f.full_name.trim() || undefined, title: nn(f.title), role_category: f.role_category, is_decision_maker: dm, email: nn(f.email), phone: nn(f.phone), mobile: nn(f.mobile),
        linkedin_url: nn(f.linkedin_url), notes: nn(f.notes), company_id: company?.id ?? null,
      };
      const res = editing ? await apiPatch<{ contact: ContactRow }>(`/api/contacts/${contact!.id}`, body) : await apiPost<{ contact: ContactRow }>('/api/contacts', body);
      toast.success(editing ? 'Contact updated' : `${res.contact.full_name} added`);
      void invalidate('/api/contacts');
      void invalidate('/api/companies');
      onSaved?.(res.contact);
      onClose();
    } catch (e) {
      if (e instanceof ClientApiError && e.status === 409) {
        const id = (e.details as { existingId?: string } | undefined)?.existingId;
        setErrors({ email: e.message });
        toast.toast({ title: e.message, tone: 'warning', action: id ? { label: 'Open', onClick: () => router.push(`/contacts/${id}`) } : undefined });
      } else if (e instanceof ClientApiError && e.status === 400 && /email/i.test(e.message)) setErrors({ email: e.message });
      else toast.error('Could not save contact', errMsg(e));
    } finally { setBusy(false); }
  };

  return (
    <SheetForm open={open} onClose={onClose} title={editing ? 'Edit contact' : 'Add contact'} submitLabel={editing ? 'Save changes' : 'Add contact'} busy={busy} onSubmit={submit}>
      <Field label="Full name" error={errors.full_name}><Input value={f.full_name} onChange={set('full_name')} autoFocus={!editing} placeholder="Jane Doe" invalid={!!errors.full_name} /></Field>
      <div className="crm-formgrid crm-formgrid--2">
        <Field label="Title"><Input value={f.title} onChange={set('title')} placeholder="VP of Operations" /></Field>
        <Field label="Role"><Select value={f.role_category} onChange={set('role_category')} options={ROLE_CATEGORIES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} /></Field>
        <Field label="Email" error={errors.email}><Input type="email" value={f.email} onChange={set('email')} autoCapitalize="none" invalid={!!errors.email} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set('phone')} inputMode="tel" /></Field>
        <Field label="Mobile"><Input value={f.mobile} onChange={set('mobile')} inputMode="tel" /></Field>
        <Field label="LinkedIn"><Input value={f.linkedin_url} onChange={set('linkedin_url')} inputMode="url" autoCapitalize="none" /></Field>
      </div>
      <Field label="Company">
        <EntityPicker value={company} onChange={setCompany} source={companySource} placeholder="Search companies…" disabled={!!companyId && !editing} />
      </Field>
      <label className="row" style={{ gap: 10, cursor: 'pointer' }}>
        <input type="checkbox" className="ui-check" checked={dm} onChange={(e) => setDm(e.target.checked)} />
        <span>Decision maker</span>
      </label>
      <Field label="Notes"><Textarea value={f.notes} onChange={set('notes')} rows={3} /></Field>
    </SheetForm>
  );
}

/* ------------------------------------------------------------------------- */

export function PropertySheet({ open, onClose, property, companyId, companyName, onSaved }: {
  open: boolean; onClose: () => void; property?: PropertyRow | null; companyId?: string | null; companyName?: string | null; onSaved?: (property: PropertyRow) => void;
}) {
  const toast = useToast();
  const editing = !!property;
  const [f, setF] = useState({ name: '', address: '', city: '', state: '', zip: '', units: '', buildings: '', year_built: '', stories: '', utility_name: '', manager_name: '', owner_name_on_record: '', meter_status: 'unknown', est_annual_water_cost: '', est_annual_water_gallons: '', notes: '' });
  const [company, setCompany] = useState<PickerOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    const p = property;
    setF({ name: s(p?.name), address: s(p?.address), city: s(p?.city), state: s(p?.state), zip: s(p?.zip), units: s(p?.units), buildings: s(p?.buildings), year_built: s(p?.year_built), stories: s(p?.stories), utility_name: s(p?.utility_name), manager_name: s(p?.manager_name), owner_name_on_record: s(p?.owner_name_on_record), meter_status: s(p?.meter_status ?? 'unknown'), est_annual_water_cost: s(p?.est_annual_water_cost), est_annual_water_gallons: s(p?.est_annual_water_gallons), notes: s(p?.notes) });
    setCompany(companyId ? { id: companyId, label: companyName ?? 'Company' } : null);
  }, [open, property, companyId, companyName]);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    if (!f.address.trim()) { setErrors({ address: 'Address is required.' }); return; }
    setBusy(true);
    try {
      const body = {
        name: nn(f.name), address: f.address.trim(), city: nn(f.city), state: nn(f.state), zip: nn(f.zip), units: numOrNull(f.units), buildings: numOrNull(f.buildings),
        year_built: numOrNull(f.year_built), stories: numOrNull(f.stories), utility_name: nn(f.utility_name), manager_name: nn(f.manager_name), owner_name_on_record: nn(f.owner_name_on_record),
        meter_status: f.meter_status, est_annual_water_cost: numOrNull(f.est_annual_water_cost), est_annual_water_gallons: numOrNull(f.est_annual_water_gallons), notes: nn(f.notes), company_id: company?.id ?? null,
      };
      const res = editing ? await apiPatch<{ property: PropertyRow }>(`/api/properties/${property!.id}`, body) : await apiPost<{ property: PropertyRow }>('/api/properties', body);
      toast.success(editing ? 'Property updated' : 'Property added');
      void invalidate('/api/properties');
      void invalidate('/api/companies');
      onSaved?.(res.property);
      onClose();
    } catch (e) { toast.error('Could not save property', errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <SheetForm open={open} onClose={onClose} title={editing ? 'Edit property' : 'Add property'} submitLabel={editing ? 'Save changes' : 'Add property'} busy={busy} onSubmit={submit}>
      <Field label="Building name"><Input value={f.name} onChange={set('name')} placeholder="Elm Court Apartments" /></Field>
      <Field label="Street address" required error={errors.address}><Input value={f.address} onChange={set('address')} autoFocus={!editing} invalid={!!errors.address} /></Field>
      <div className="crm-formgrid crm-formgrid--3">
        <Field label="City"><Input value={f.city} onChange={set('city')} /></Field>
        <Field label="State"><Input value={f.state} onChange={set('state')} maxLength={2} autoCapitalize="characters" /></Field>
        <Field label="ZIP"><Input value={f.zip} onChange={set('zip')} inputMode="numeric" /></Field>
      </div>
      <div className="crm-formgrid crm-formgrid--3">
        <Field label="Units"><Input value={f.units} onChange={set('units')} inputMode="numeric" /></Field>
        <Field label="Buildings"><Input value={f.buildings} onChange={set('buildings')} inputMode="numeric" /></Field>
        <Field label="Stories"><Input value={f.stories} onChange={set('stories')} inputMode="numeric" /></Field>
        <Field label="Year built"><Input value={f.year_built} onChange={set('year_built')} inputMode="numeric" /></Field>
        <Field label="Est. water cost / yr"><Input value={f.est_annual_water_cost} onChange={set('est_annual_water_cost')} inputMode="decimal" placeholder="$" /></Field>
        <Field label="Est. gallons / yr"><Input value={f.est_annual_water_gallons} onChange={set('est_annual_water_gallons')} inputMode="numeric" /></Field>
      </div>
      <div className="crm-formgrid crm-formgrid--2">
        <Field label="Water utility"><Input value={f.utility_name} onChange={set('utility_name')} /></Field>
        <Field label="Meter status"><Select value={f.meter_status} onChange={set('meter_status')} options={METER_STATUSES.map((m) => ({ value: m, label: m.replace('_', ' ') }))} /></Field>
        <Field label="Manager"><Input value={f.manager_name} onChange={set('manager_name')} /></Field>
        <Field label="Owner on record"><Input value={f.owner_name_on_record} onChange={set('owner_name_on_record')} /></Field>
      </div>
      <Field label="Company"><EntityPicker value={company} onChange={setCompany} source={companySource} placeholder="Search companies…" disabled={!!companyId && !editing} /></Field>
      <Field label="Notes"><Textarea value={f.notes} onChange={set('notes')} rows={3} /></Field>
    </SheetForm>
  );
}

/* ------------------------------------------------------------------------- */

function defaultDue() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return toLocalInput(d);
}

export function TaskSheet({ open, onClose, task, companyId, companyName, contactId, onSaved }: {
  open: boolean; onClose: () => void; task?: TaskRow | null; companyId?: string | null; companyName?: string | null; contactId?: string | null; onSaved?: (task: TaskRow) => void;
}) {
  const toast = useToast();
  const editing = !!task;
  const [f, setF] = useState({ title: '', type: 'follow_up', priority: 'normal', due: '', notes: '' });
  const [company, setCompany] = useState<PickerOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setF({ title: s(task?.title), type: s(task?.type ?? 'follow_up'), priority: s(task?.priority ?? 'normal'), due: task ? toLocalInput(task.due_at) : defaultDue(), notes: s(task?.notes) });
    setCompany(task?.company_id ? { id: task.company_id, label: companyName ?? 'Company' } : companyId ? { id: companyId, label: companyName ?? 'Company' } : null);
  }, [open, task, companyId, companyName]);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    if (!f.title.trim()) { setError('Give the task a title.'); return; }
    setBusy(true);
    try {
      const body = {
        title: f.title.trim(), type: f.type, priority: f.priority, notes: nn(f.notes), company_id: company?.id ?? null,
        ...(contactId && !editing ? { contact_id: contactId } : {}),
        due_at: f.due ? new Date(f.due).toISOString() : null,
      };
      const res = editing ? await apiPatch<{ task: TaskRow }>(`/api/tasks/${task!.id}`, body) : await apiPost<{ task: TaskRow }>('/api/tasks', body);
      toast.success(editing ? 'Task updated' : 'Task added');
      void invalidate('/api/tasks');
      void invalidate('/api/companies');
      void invalidate('/api/dashboard');
      onSaved?.(res.task);
      onClose();
    } catch (e) { toast.error('Could not save task', errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <SheetForm open={open} onClose={onClose} title={editing ? 'Edit task' : 'New task'} submitLabel={editing ? 'Save changes' : 'Add task'} busy={busy} onSubmit={submit} size="sm">
      <Field label="Title" required error={error}><Input value={f.title} onChange={set('title')} autoFocus placeholder="Call Jane about the pilot" invalid={!!error} /></Field>
      <div className="crm-formgrid crm-formgrid--2">
        <Field label="Type"><Select value={f.type} onChange={set('type')} options={TASK_TYPES.map((t) => ({ value: t, label: TASK_TYPE_LABELS[t] }))} /></Field>
        <Field label="Priority"><Select value={f.priority} onChange={set('priority')} options={TASK_PRIORITIES.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))} /></Field>
      </div>
      <Field label="Due"><Input type="datetime-local" value={f.due} onChange={set('due')} /></Field>
      <Field label="Company"><EntityPicker value={company} onChange={setCompany} source={companySource} placeholder="Link to a company (optional)" /></Field>
      <Field label="Notes"><Textarea value={f.notes} onChange={set('notes')} rows={3} /></Field>
    </SheetForm>
  );
}
