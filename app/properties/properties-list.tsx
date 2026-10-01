'use client';

import { Building, Download, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Badge, Button, Chip, DataTable, EmptyState, PageHeader, SearchInput, type DataTableColumn } from '@/app/ui';
import { useApi } from '@/lib/client/api';
import { fmtMoney, fmtNumber } from '@/lib/crm/format';
import type { PropertyListRow } from '@/lib/crm/types';
import { errMsg, Pager } from '@/lib/crm/ui/common';
import { PropertySheet } from '@/lib/crm/ui/forms';

const LIMIT = 50;
const METER_LABEL: Record<string, string> = { unknown: 'Unknown', smart: 'Smart meter', ami_available: 'AMI available', manual: 'Manual read', puma_installed: 'Puma meter' };

export function PropertiesList() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const q = sp.get('q') ?? '';
  const state = sp.get('state') ?? '';
  const minUnits = sp.get('minUnits') ?? '';
  const page = Math.max(0, Number(sp.get('page') ?? 0) || 0);
  const [adding, setAdding] = useState(false);

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === '') next.delete(k); else next.set(k, v); }
    if (!('page' in patch)) next.delete('page');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const qs = useMemo(() => { const p = new URLSearchParams(); if (q) p.set('q', q); if (state) p.set('state', state); if (minUnits) p.set('minUnits', minUnits); return p.toString(); }, [q, state, minUnits]);
  const { data, error, isLoading, mutate } = useApi<{ rows: PropertyListRow[]; total: number }>(`/api/properties?limit=${LIMIT}&offset=${page * LIMIT}${qs ? `&${qs}` : ''}`);

  const columns: DataTableColumn<PropertyListRow>[] = [
    { key: 'name', header: 'Property', mobile: 'title', cell: (p) => <div className="crm-namecell__text"><span className="crm-namecell__name">{p.name || p.address}</span><span className="crm-namecell__sub">{[p.name ? p.address : null, p.city, p.state].filter(Boolean).join(', ')}</span></div> },
    { key: 'company', header: 'Company', cell: (p) => p.company_id ? <Link href={`/companies/${p.company_id}`} style={{ color: 'inherit' }}>{p.company_name}</Link> : <span className="subtle">Unassigned</span> },
    { key: 'units', header: 'Units', align: 'right', cell: (p) => <span className="num">{fmtNumber(p.units)}</span> },
    { key: 'year', header: 'Built', muted: true, cell: (p) => p.year_built ?? '—' },
    { key: 'utility', header: 'Utility', muted: true, cell: (p) => p.utility_name ?? '—' },
    { key: 'meter', header: 'Meter', cell: (p) => <Badge tone={p.meter_status === 'puma_installed' ? 'success' : p.meter_status === 'unknown' ? 'neutral' : 'info'}>{METER_LABEL[p.meter_status]}</Badge> },
    { key: 'cost', header: 'Est. water cost', align: 'right', cell: (p) => <span className="num">{fmtMoney(p.est_annual_water_cost, { compact: true })}</span> },
  ];
  const mobileCard = (p: PropertyListRow) => (
    <div className="crm-card">
      <div className="crm-card__top"><div className="grow"><div className="crm-namecell__name" style={{ whiteSpace: 'normal' }}>{p.name || p.address}</div><div className="crm-namecell__sub">{[p.name ? p.address : null, p.city, p.state].filter(Boolean).join(', ')}</div></div><Badge tone={p.meter_status === 'puma_installed' ? 'success' : 'neutral'}>{METER_LABEL[p.meter_status]}</Badge></div>
      <dl className="crm-card__meta">
        <div><dt>Company</dt><dd>{p.company_name ?? 'Unassigned'}</dd></div>
        <div><dt>Units</dt><dd>{fmtNumber(p.units)}</dd></div>
        <div><dt>Utility</dt><dd>{p.utility_name ?? '—'}</dd></div>
        <div><dt>Est. water cost</dt><dd>{fmtMoney(p.est_annual_water_cost, { compact: true })}</dd></div>
      </dl>
    </div>
  );

  const total = data?.total ?? 0;
  const empty = !isLoading && !error && data && total === 0;
  const filtered = !!(q || state || minUnits);

  return (
    <div className="page">
      <PageHeader title="Properties" subtitle={data ? `${total.toLocaleString()} ${total === 1 ? 'building' : 'buildings'}` : 'Buildings and water estimates'}
        actions={<><Button icon={Download} href={`/api/export/properties.csv${qs ? `?${qs}` : ''}`} className="hide-mobile">Export</Button><Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add property</Button></>} />
      <div className="crm-toolbar">
        <SearchInput className="crm-toolbar__search" value={q} debounce={250} onChange={(v) => setParams({ q: v })} placeholder="Search address, name, city, company" />
        <div className="crm-filters crm-filters--scroll">
          {['NJ', 'NY', 'PA'].map((s) => <Chip key={s} selected={state === s} onClick={() => setParams({ state: state === s ? null : s })}>{s}</Chip>)}
          <Chip selected={minUnits === '100'} onClick={() => setParams({ minUnits: minUnits === '100' ? null : '100' })}>100+ units</Chip>
          <Chip selected={minUnits === '300'} onClick={() => setParams({ minUnits: minUnits === '300' ? null : '300' })}>300+ units</Chip>
        </div>
      </div>
      {error && !data ? <EmptyState bordered icon={Building} title="Couldn't load properties" description={errMsg(error)} actions={<Button onClick={() => void mutate()}>Try again</Button>} />
        : empty ? <EmptyState bordered icon={Building} title={filtered ? 'No properties match' : 'No properties yet'} description={filtered ? 'Try clearing a filter.' : 'Add the buildings your companies own or manage, or run research to discover them.'} actions={filtered ? <Button onClick={() => router.replace(pathname)}>Clear filters</Button> : <><Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add property</Button><Button href="/leads">Find leads</Button></>} />
        : <DataTable aria-label="Properties" rows={data?.rows ?? []} columns={columns} getRowId={(p) => p.id} rowHref={(p) => `/properties/${p.id}`} loading={isLoading && !data} mobileCard={mobileCard} footer={<Pager offset={page * LIMIT} limit={LIMIT} total={total} onChange={(o) => setParams({ page: String(o / LIMIT) })} />} />}
      <PropertySheet open={adding} onClose={() => setAdding(false)} onSaved={(p) => router.push(`/properties/${p.id}`)} />
    </div>
  );
}
