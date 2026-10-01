'use client';

import './crm.css';
import { AlertTriangle, Check, Droplets, Flame, Gauge, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Field, Input, Select, Sheet, useToast } from '@/app/ui';
import { apiPatch, apiPost, invalidate } from '@/lib/client/api';
import { relTime } from '../format';
import type { AlertRow } from '../types';
import { errMsg } from './common';

export type MeterOption = { id: string; label: string; property_name?: string | null };

export function Sparkline({ values, width = 120, height = 34, color = 'var(--info)' }: { values: Array<number | null>; width?: number; height?: number; color?: string }) {
  const v = values.filter((x): x is number => typeof x === 'number');
  if (v.length < 2) return <svg className="crm-spark" width={width} height={height} aria-hidden />;
  const max = Math.max(...v);
  const min = Math.min(...v);
  const span = max - min || 1;
  const pts = v.map((y, i) => `${(i / (v.length - 1)) * (width - 4) + 2},${height - 3 - ((y - min) / span) * (height - 8)}`);
  const last = pts[pts.length - 1].split(',');
  return (
    <svg className="crm-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Recent usage trend">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />
    </svg>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

export function ReadingSheet({ open, onClose, meters, meterId, onSaved }: { open: boolean; onClose: () => void; meters: MeterOption[]; meterId?: string | null; onSaved?: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ meter: '', start: '', end: today(), gallons: '', cost: '', nightGph: '' });
  const [continuous, setContinuous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setError(''); setContinuous(false);
    setF({ meter: meterId ?? meters[0]?.id ?? '', start: '', end: today(), gallons: '', cost: '', nightGph: '' });
  }, [open, meterId, meters]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[$,\s]/g, '')));

  const submit = async () => {
    if (!f.meter) { setError('Choose a meter.'); return; }
    if (n(f.gallons) === null && n(f.cost) === null) { setError('Enter gallons or cost.'); return; }
    setBusy(true);
    try {
      const res = await apiPost<{ alerts: AlertRow[] }>('/api/monitor/readings', {
        meter_id: f.meter, period_start: f.start || null, period_end: f.end, gallons: n(f.gallons), cost: n(f.cost),
        ...(continuous ? { continuous_flow: true } : {}), ...(n(f.nightGph) !== null ? { min_night_gph: n(f.nightGph) } : {}),
      });
      if (res.alerts.length) toast.toast({ title: `${res.alerts.length} ${res.alerts.length === 1 ? 'alert' : 'alerts'} raised`, description: res.alerts.map((a) => a.title).join(' · '), tone: 'warning' });
      else toast.success('Reading saved', 'Usage looks normal.');
      void invalidate('/api/monitor');
      void invalidate('/api/properties');
      onSaved?.();
      onClose();
    } catch (e) { setError(errMsg(e)); toast.error('Could not save reading', errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} size="sm" title="Add meter reading" description="Manual readings are checked for continuous flow and spikes against recent usage."
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit} disabled={!meters.length}>Save reading</Button></>}>
      <div className="stack">
        <Field label="Meter" required><Select value={f.meter} onChange={set('meter')} options={meters.map((m) => ({ value: m.id, label: m.property_name ? `${m.property_name} · ${m.label}` : m.label }))} disabled={!!meterId} placeholder="Choose a meter" /></Field>
        <div className="crm-formgrid crm-formgrid--2">
          <Field label="Period start" hint="Defaults to the last reading"><Input type="date" value={f.start} onChange={set('start')} /></Field>
          <Field label="Period end" required><Input type="date" value={f.end} onChange={set('end')} /></Field>
          <Field label="Gallons used"><Input value={f.gallons} onChange={set('gallons')} inputMode="decimal" placeholder="2,450,000" /></Field>
          <Field label="Cost"><Input value={f.cost} onChange={set('cost')} inputMode="decimal" placeholder="$" /></Field>
        </div>
        <Field label="Lowest overnight flow (gal/hr)" hint="Above ~1 gal/hr overnight usually means a leak."><Input value={f.nightGph} onChange={set('nightGph')} inputMode="decimal" placeholder="0" /></Field>
        <label className="row" style={{ gap: 10, cursor: 'pointer' }}><input type="checkbox" className="ui-check" checked={continuous} onChange={(e) => setContinuous(e.target.checked)} /><span>Flow never stopped during this period</span></label>
        {error && <p className="ui-field__error" role="alert">{error}</p>}
      </div>
    </Sheet>
  );
}

export function AddMeterSheet({ open, onClose, properties, propertyId, onSaved }: { open: boolean; onClose: () => void; properties: Array<{ id: string; name: string }>; propertyId?: string | null; onSaved?: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ property: '', label: 'Master meter', number: '', account: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF({ property: propertyId ?? properties[0]?.id ?? '', label: 'Master meter', number: '', account: '' }); }, [open, propertyId, properties]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const submit = async () => {
    if (!f.property || !f.label.trim()) return;
    setBusy(true);
    try {
      await apiPost('/api/monitor/meters', { property_id: f.property, label: f.label.trim(), meter_number: f.number || null, utility_account: f.account || null });
      toast.success('Meter added');
      void invalidate('/api/monitor'); void invalidate('/api/properties');
      onSaved?.(); onClose();
    } catch (e) { toast.error('Could not add meter', errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} size="sm" title="Add meter" footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Add meter</Button></>}>
      <div className="stack">
        <Field label="Property" required><Select value={f.property} onChange={set('property')} disabled={!!propertyId} options={properties.map((p) => ({ value: p.id, label: p.name }))} placeholder="Choose a property" /></Field>
        <Field label="Label" required><Input value={f.label} onChange={set('label')} placeholder="Master meter" /></Field>
        <div className="crm-formgrid crm-formgrid--2">
          <Field label="Meter number"><Input value={f.number} onChange={set('number')} /></Field>
          <Field label="Utility account"><Input value={f.account} onChange={set('account')} /></Field>
        </div>
      </div>
    </Sheet>
  );
}

const KIND_ICON = { continuous_flow: Droplets, spike: Flame, spend_threshold: Gauge, no_data: AlertTriangle } as const;
const KIND_LABEL = { continuous_flow: 'Continuous flow', spike: 'Usage spike', spend_threshold: 'Spend', no_data: 'No data' } as const;

export function AlertItem({ alert, onChanged, context }: { alert: AlertRow & { property_name?: string | null; company_name?: string | null; meter_label?: string | null }; onChanged?: () => void; context?: boolean }) {
  const toast = useToast();
  const Icon = KIND_ICON[alert.kind] ?? AlertTriangle;
  const set = async (status: AlertRow['status']) => {
    try { await apiPatch(`/api/monitor/alerts/${alert.id}`, { status }); toast.success(status === 'resolved' ? 'Alert resolved' : status === 'acknowledged' ? 'Alert acknowledged' : 'Alert reopened'); void invalidate('/api/monitor'); void invalidate('/api/properties'); onChanged?.(); }
    catch (e) { toast.error('Could not update alert', errMsg(e)); }
  };
  return (
    <div className="crm-alert" style={alert.status === 'resolved' ? { opacity: 0.55 } : undefined}>
      <span className={`crm-alert__icon crm-alert__icon--${alert.severity}`}><Icon aria-hidden /></span>
      <div className="crm-alert__main">
        <div className="row-wrap" style={{ gap: 8 }}>
          <span className="crm-alert__title">{alert.title}</span>
          <Badge tone={alert.severity === 'critical' ? 'danger' : alert.severity === 'warning' ? 'warning' : 'info'}>{alert.severity}</Badge>
          {alert.status !== 'open' && <Badge tone={alert.status === 'resolved' ? 'success' : 'neutral'}>{alert.status}</Badge>}
        </div>
        {alert.detail && <span className="text-sm muted">{alert.detail}</span>}
        <span className="text-xs subtle">{KIND_LABEL[alert.kind]} · {relTime(alert.detected_at)}{context && alert.company_name ? ` · ${alert.company_name}` : ''}</span>
        <div className="crm-alert__actions">
          {alert.status === 'open' && <Button size="sm" icon={Check} onClick={() => void set('acknowledged')}>Acknowledge</Button>}
          {alert.status !== 'resolved' && <Button size="sm" variant="secondary" onClick={() => void set('resolved')}>Resolve</Button>}
          {alert.status !== 'open' && <Button size="sm" variant="ghost" icon={Undo2} onClick={() => void set('open')}>Reopen</Button>}
        </div>
      </div>
    </div>
  );
}
