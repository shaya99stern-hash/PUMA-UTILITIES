'use client';

import { BellRing, Droplets, Plus, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton, Stat, Tabs } from '@/app/ui';
import { useApi } from '@/lib/client/api';
import { fmtDate, fmtGallons, fmtMoney } from '@/lib/crm/format';
import type { AlertRow } from '@/lib/crm/types';
import { errMsg } from '@/lib/crm/ui/common';
import { AddMeterSheet, AlertItem, ReadingSheet, Sparkline } from '@/lib/crm/ui/monitor';

type Alert = AlertRow & { property_name: string | null; company_id: string | null; company_name: string | null; meter_label: string | null };
type Meter = { id: string; label: string; meter_number: string | null; property_id: string; property_name: string; company_id: string; company_name: string; last_period_end: string | null; last_gallons: number | null; last_cost: number | null; recent: Array<number | null>; open_alerts: number; status: string };
type Resp = {
  alerts: Alert[]; meters: Meter[]; properties: Array<{ id: string; name: string; company_name: string; meter_count: number }>;
  summary: { open_alerts: number; critical_alerts: number; active_meters: number; client_companies: number };
};

export function MonitorView() {
  const [filter, setFilter] = useState('open');
  const { data, error, isLoading, mutate } = useApi<Resp>(`/api/monitor?status=${filter === 'all' ? 'all' : 'active'}`);
  const [reading, setReading] = useState<{ open: boolean; meterId?: string | null }>({ open: false });
  const [addMeter, setAddMeter] = useState(false);
  const meterOptions = useMemo(() => (data?.meters ?? []).map((m) => ({ id: m.id, label: m.label, property_name: m.property_name })), [data?.meters]);
  const s = data?.summary;
  const shownAlerts = (data?.alerts ?? []).filter((a) => (filter === 'all' ? true : a.status !== 'resolved'));

  const actions = (
    <>
      <Button icon={Plus} onClick={() => setAddMeter(true)} disabled={!data?.properties.length}>Meter</Button>
      <Button variant="primary" icon={Droplets} onClick={() => setReading({ open: true })} disabled={!data?.meters.length}>Add reading</Button>
    </>
  );

  return (
    <div className="page">
      <PageHeader title="Monitor" subtitle="Client-authorized meter data and leak alerts. Prospects are never monitored." actions={actions} />
      {error && !data ? <EmptyState bordered icon={BellRing} title="Couldn't load monitoring" description={errMsg(error)} actions={<Button onClick={() => void mutate()}>Try again</Button>} />
        : isLoading && !data ? <div className="crm-stats">{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={84} radius={12} />)}</div>
        : data && s && s.client_companies === 0 ? (
          <EmptyState bordered icon={ShieldCheck} title="No clients to monitor yet" description="Monitoring starts once a company becomes a client and authorizes access to its water data. Move a company to the Client stage to begin." actions={<><Button variant="primary" href="/pipeline">Open pipeline</Button><Button href="/companies?stage=installation">View installations</Button></>} />
        ) : data && s && (
          <>
            <div className="crm-stats">
              <Stat label="Open alerts" value={s.open_alerts} tone={s.open_alerts ? 'warning' : 'default'} icon={BellRing} />
              <Stat label="Critical" value={s.critical_alerts} tone={s.critical_alerts ? 'danger' : 'default'} hint={s.critical_alerts ? 'Needs attention' : 'All clear'} />
              <Stat label="Active meters" value={s.active_meters} icon={Droplets} />
              <Stat label="Client companies" value={s.client_companies} href="/companies?stage=client" />
            </div>

            <div className="stack-lg">
              <section>
                <div className="row-between" style={{ marginBottom: 8 }}>
                  <h2 className="section-title">Alerts</h2>
                  <Tabs variant="pill" aria-label="Alert filter" value={filter} onChange={setFilter} items={[{ value: 'open', label: 'Active' }, { value: 'all', label: 'All' }]} />
                </div>
                <Card flush>
                  {shownAlerts.length === 0 ? <div style={{ padding: 16 }}><EmptyState compact icon={ShieldCheck} title="No active alerts" description="Continuous flow and usage spikes from new readings will show up here." /></div>
                    : shownAlerts.map((a) => (
                      <div key={a.id} style={{ position: 'relative' }}><AlertItem alert={a} context onChanged={() => void mutate()} /></div>
                    ))}
                </Card>
              </section>

              <section>
                <h2 className="section-title" style={{ marginBottom: 8 }}>Meters</h2>
                {data.meters.length === 0 ? (
                  <EmptyState bordered icon={Droplets} title="No meters yet" description="Add a meter to a client property, then enter readings to start watching for leaks and spikes." actions={<Button variant="primary" icon={Plus} onClick={() => setAddMeter(true)}>Add meter</Button>} />
                ) : (
                  <div className="crm-metergrid">
                    {data.meters.map((m) => (
                      <Card key={m.id}>
                        <div className="crm-meter">
                          <div className="crm-meter__top">
                            <div style={{ minWidth: 0 }}>
                              <Link href={`/properties/${m.property_id}`} className="strong" style={{ color: 'inherit' }}>{m.property_name}</Link>
                              <div className="text-sm muted truncate">{m.label}{m.meter_number ? ` · ${m.meter_number}` : ''}</div>
                              <Link href={`/companies/${m.company_id}`} className="text-xs subtle">{m.company_name}</Link>
                            </div>
                            {m.open_alerts > 0 ? <Badge tone="warning" dot>{m.open_alerts} open</Badge> : <Badge tone="success" dot>Normal</Badge>}
                          </div>
                          <div className="row-between">
                            <div className="crm-meter__vals">
                              <div className="crm-meter__val"><b>{fmtGallons(m.last_gallons)}</b><span>{m.last_period_end ? `to ${fmtDate(m.last_period_end)}` : 'No readings'}</span></div>
                              <div className="crm-meter__val"><b>{fmtMoney(m.last_cost)}</b><span>cost</span></div>
                            </div>
                            <Sparkline values={m.recent} color={m.open_alerts ? 'var(--warning)' : 'var(--info)'} />
                          </div>
                          <Button size="sm" icon={Plus} onClick={() => setReading({ open: true, meterId: m.id })}>Add reading</Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      <ReadingSheet open={reading.open} onClose={() => setReading({ open: false })} meters={meterOptions} meterId={reading.meterId} onSaved={() => void mutate()} />
      <AddMeterSheet open={addMeter} onClose={() => setAddMeter(false)} properties={data?.properties ?? []} onSaved={() => void mutate()} />
    </div>
  );
}
