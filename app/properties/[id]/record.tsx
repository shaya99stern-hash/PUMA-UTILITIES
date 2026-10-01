'use client';

import { Building, Droplets, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Avatar, Badge, Button, Card, EmptyState, IconButton, KeyValue, Menu, PageHeader, Skeleton, Stat, StageBadge, Tabs, useToast } from '@/app/ui';
import { apiDelete, ClientApiError, invalidate, useApi } from '@/lib/client/api';
import { fmtDate, fmtGallons, fmtMoney, fmtNumber } from '@/lib/crm/format';
import type { ActivityListRow, AlertRow, EvidenceRow, MeterReadingRow, MeterRow, PropertyRow } from '@/lib/crm/types';
import { ActivityComposer, ActivityFeed } from '@/lib/crm/ui/activity';
import { ConfirmModal, errMsg } from '@/lib/crm/ui/common';
import { PropertySheet } from '@/lib/crm/ui/forms';
import { AddMeterSheet, AlertItem, ReadingSheet, Sparkline } from '@/lib/crm/ui/monitor';

type Detail = {
  property: PropertyRow; company: { id: string; name: string; stage: string; domain: string | null } | null; meters: MeterRow[]; readings: MeterReadingRow[];
  alerts: AlertRow[]; activities: ActivityListRow[]; evidence: EvidenceRow[]; monitoring: boolean;
};
const METER_LABEL: Record<string, string> = { unknown: 'Unknown', smart: 'Smart meter', ami_available: 'AMI available', manual: 'Manual read', puma_installed: 'Puma meter' };

export function PropertyRecord({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const { data, error, mutate } = useApi<Detail>(`/api/properties/${id}`);
  const [tab, setTab] = useState('details');
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reading, setReading] = useState<{ open: boolean; meterId?: string | null }>({ open: false });
  const [addMeter, setAddMeter] = useState(false);

  const meterOptions = useMemo(() => (data?.meters ?? []).map((m) => ({ id: m.id, label: m.label })), [data?.meters]);

  if (error && !data) {
    const nf = error instanceof ClientApiError && error.status === 404;
    return <div className="page"><PageHeader back={{ href: '/properties', label: 'Properties' }} title={nf ? 'Property not found' : 'Could not load property'} /><EmptyState bordered icon={Building} title={nf ? 'This property does not exist' : 'Something went wrong'} description={nf ? 'It may have been deleted.' : errMsg(error)} actions={<Button href="/properties">Back to properties</Button>} /></div>;
  }
  if (!data) return <div className="page"><Skeleton width="40%" height={28} /><div style={{ height: 16 }} /><Skeleton lines={8} /></div>;

  const { property: p, company, meters, readings, alerts, activities, evidence, monitoring } = data;
  const centerTab = tab === 'monitoring' && monitoring ? 'monitoring' : 'notes';
  const remove = async () => {
    try { await apiDelete(`/api/properties/${id}`); toast.success('Property deleted'); void invalidate('/api/properties'); router.push('/properties'); } catch (e) { toast.error('Could not delete', errMsg(e)); throw e; }
  };
  const readingsFor = (meterId: string) => readings.filter((r) => r.meter_id === meterId);

  return (
    <div className="page">
      <PageHeader
        back={{ href: '/properties', label: 'Properties' }} title={p.name || p.address} shellTitle={p.name || p.address}
        subtitle={[p.name ? p.address : null, p.city, p.state, p.zip].filter(Boolean).join(', ')}
        actions={<><Button icon={Pencil} onClick={() => setEditing(true)}>Edit</Button><Menu trigger={<IconButton icon={MoreHorizontal} label="More actions" variant="secondary" />} items={[{ label: 'Delete property', icon: Trash2, danger: true, onSelect: () => setDeleting(true) }]} /></>}
      >
        <div className="crm-head-meta">
          {company && <Link href={`/companies/${company.id}`}><Avatar name={company.name} square size="xs" />{company.name}</Link>}
          {company && <StageBadge stage={company.stage} />}
          <Badge tone={p.meter_status === 'puma_installed' ? 'success' : 'neutral'}>{METER_LABEL[p.meter_status]}</Badge>
        </div>
      </PageHeader>

      <div className="crm-narrow-only crm-tabs-scroll" style={{ marginBottom: 12 }}>
        <Tabs aria-label="Sections" value={tab} onChange={setTab} items={[{ value: 'details', label: 'Details' }, { value: 'notes', label: 'Notes' }, ...(monitoring ? [{ value: 'monitoring', label: 'Monitoring', count: alerts.filter((a) => a.status === 'open').length || null }] : [])]} />
      </div>

      <div className="crm-record crm-record--2" data-tab={tab === 'details' ? 'overview' : tab}>
        <div className="crm-col">
          <div data-pane="overview">
            <div className="crm-stats" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginBottom: 0 }}>
              <Stat label="Units" value={fmtNumber(p.units)} hint={p.buildings ? `${p.buildings} ${p.buildings === 1 ? 'building' : 'buildings'}` : undefined} />
              <Stat label="Est. water cost" value={fmtMoney(p.est_annual_water_cost, { compact: true })} hint="per year" tone="accent" />
            </div>
          </div>
          <Card data-pane="overview" title="Building" actions={<Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>}>
            <KeyValue items={[
              { label: 'Address', value: [p.address, p.city, p.state, p.zip].filter(Boolean).join(', '), copy: true },
              { label: 'Year built', value: p.year_built }, { label: 'Stories', value: p.stories }, { label: 'Class', value: p.building_class },
              { label: 'Gross sq ft', value: p.gross_sqft ? fmtNumber(p.gross_sqft) : null }, { label: 'Owner on record', value: p.owner_name_on_record }, { label: 'Manager', value: p.manager_name },
            ]} />
          </Card>
          <Card data-pane="overview" title="Water & utility">
            <KeyValue items={[
              { label: 'Utility', value: p.utility_name }, { label: 'PWSID', value: p.utility_pwsid },
              { label: 'Meter status', value: METER_LABEL[p.meter_status] },
              { label: 'Est. annual use', value: fmtGallons(p.est_annual_water_gallons) },
              { label: 'Est. annual cost', value: p.est_annual_water_cost != null ? fmtMoney(p.est_annual_water_cost) : null },
              { label: 'Reported use', value: p.reported_water_kgal != null ? `${fmtNumber(p.reported_water_kgal)} kgal${p.reported_water_year ? ` (${p.reported_water_year})` : ''}` : null },
            ]} />
          </Card>
          {evidence.length > 0 && (
            <Card data-pane="overview" title="Sources" flush divided>
              <div className="crm-rows">{evidence.slice(0, 8).map((e) => <div key={e.id} className="crm-row"><span className="crm-row__main"><span className="crm-row__title"><span>{e.field.replace(/_/g, ' ')}</span></span>{e.value && <span className="text-sm">{e.value}</span>}<span className="crm-row__sub">{e.source_name} · {fmtDate(e.retrieved_at)}</span></span></div>)}</div>
            </Card>
          )}
        </div>

        <div className="crm-col">
          <Card data-pane="notes monitoring">
            {monitoring && (
              <div className="crm-center-tabs crm-desktop-only">
                <Tabs aria-label="Record" value={centerTab} onChange={setTab} items={[{ value: 'notes', label: 'Notes' }, { value: 'monitoring', label: 'Monitoring', count: alerts.filter((a) => a.status === 'open').length || null }]} />
              </div>
            )}
            {centerTab === 'notes' ? (
              <div className="stack-lg">
                <ActivityComposer propertyId={id} companyId={p.company_id} placeholder="Site visit notes, access details, building quirks…" onLogged={() => void mutate()} />
                <hr className="divider" />
                <ActivityFeed items={activities} onChanged={() => void mutate()} />
              </div>
            ) : (
              <div className="stack-lg">
                <div className="row-between"><span className="section-title">Meters</span><div className="row"><Button size="sm" icon={Plus} onClick={() => setAddMeter(true)}>Meter</Button><Button size="sm" variant="primary" icon={Droplets} disabled={!meters.length} onClick={() => setReading({ open: true })}>Add reading</Button></div></div>
                {meters.length === 0 ? <EmptyState compact icon={Droplets} title="No meters yet" description="Add a meter to start tracking client-authorized usage." actions={<Button size="sm" variant="primary" icon={Plus} onClick={() => setAddMeter(true)}>Add meter</Button>} /> : meters.map((m) => {
                  const rs = readingsFor(m.id);
                  return (
                    <div key={m.id} className="stack-sm">
                      <div className="row-between"><span className="strong">{m.label}{m.meter_number && <span className="subtle"> · {m.meter_number}</span>}</span><Sparkline values={[...rs].reverse().map((r) => r.gallons)} /></div>
                      {rs.length ? (
                        <div style={{ margin: '0 -16px', overflowX: 'auto' }}>
                          <table className="ui-dt__table" style={{ minWidth: 380 }}><thead><tr><th>Period end</th><th className="ui-dt__align-right">Gallons</th><th className="ui-dt__align-right">Cost</th></tr></thead>
                            <tbody>{rs.slice(0, 6).map((r) => <tr key={r.id}><td>{fmtDate(r.period_end)}</td><td className="ui-dt__align-right num">{fmtNumber(r.gallons)}</td><td className="ui-dt__align-right num">{fmtMoney(r.cost)}</td></tr>)}</tbody></table>
                        </div>
                      ) : <p className="text-sm muted">No readings yet.</p>}
                    </div>
                  );
                })}
                {alerts.length > 0 && <div><span className="section-title">Alerts</span><div style={{ margin: '8px -16px 0' }}>{alerts.map((a) => <AlertItem key={a.id} alert={a} onChanged={() => void mutate()} />)}</div></div>}
              </div>
            )}
          </Card>
        </div>
      </div>

      <PropertySheet open={editing} onClose={() => setEditing(false)} property={p} onSaved={() => void mutate()} />
      <ReadingSheet open={reading.open} onClose={() => setReading({ open: false })} meters={meterOptions} meterId={reading.meterId} onSaved={() => void mutate()} />
      <AddMeterSheet open={addMeter} onClose={() => setAddMeter(false)} properties={[{ id, name: p.name || p.address }]} propertyId={id} onSaved={() => void mutate()} />
      <ConfirmModal open={deleting} onClose={() => setDeleting(false)} title="Delete this property?" description="Its meters, readings and alerts are deleted too." onConfirm={remove} />
    </div>
  );
}
