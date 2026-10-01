'use client';

import { Building2, Download, Mail, Megaphone, MoreHorizontal, Plus, Search, Tag, Trash2, Upload, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import {
  Avatar, Button, Chip, DataTable, EmptyState, IconButton, Input, Menu, Modal, PageHeader, ScorePill, SearchInput, STAGES, StageBadge, Tabs, useToast,
  type DataTableColumn, type MenuItem, type SortState,
} from '@/app/ui';
import { apiPost, invalidate, useApi } from '@/lib/client/api';
import { fmtMoney, fmtNumber, relTime, isOverdue } from '@/lib/crm/format';
import { COMPANY_TYPES, COMPANY_TYPE_LABELS, STAGE_LABELS, type CompanyListRow, type Stage } from '@/lib/crm/types';
import { ConfirmModal, errMsg, Pager } from '@/lib/crm/ui/common';
import { CompanySheet } from '@/lib/crm/ui/forms';
import { ImportModal } from './import-modal';

const LIMIT = 50;
type ListResponse = { rows: CompanyListRow[]; total: number; counts: Record<string, number>; facets: { states: Array<{ value: string; n: number }>; tags: Array<{ value: string; n: number }> } };

const SCORE_OPTIONS = [0, 40, 60, 80];

function portfolio(c: CompanyListRow) {
  const b = c.portfolio_buildings;
  const u = c.portfolio_units;
  if (b == null && u == null) return null;
  return [b != null ? `${fmtNumber(b)} ${b === 1 ? 'bldg' : 'bldgs'}` : null, u != null ? `${fmtNumber(u)} units` : null].filter(Boolean).join(' · ');
}
const location = (c: CompanyListRow) => [c.city, c.state].filter(Boolean).join(', ');

export function CompaniesList() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const toast = useToast();

  const stage = sp.get('stage') ?? 'all';
  const q = sp.get('q') ?? '';
  const state = sp.get('state') ?? '';
  const type = sp.get('type') ?? '';
  const tag = sp.get('tag') ?? '';
  const minScore = Number(sp.get('minScore') ?? 0) || 0;
  const hasEmail = sp.get('hasEmail') === '1';
  const sort = sp.get('sort') ?? 'last_activity';
  const dir = sp.get('dir') ?? 'desc';
  const page = Math.max(0, Number(sp.get('page') ?? 0) || 0);

  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '' || v === '0' && k !== 'page') next.delete(k); else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  const query = useMemo(() => {
    const p = new URLSearchParams({ limit: String(LIMIT), offset: String(page * LIMIT), sort, dir, facets: '1' });
    if (stage !== 'all') p.set('stage', stage);
    if (q) p.set('q', q);
    if (state) p.set('state', state);
    if (type) p.set('type', type);
    if (tag) p.set('tag', tag);
    if (minScore) p.set('minScore', String(minScore));
    if (hasEmail) p.set('hasEmail', '1');
    return p.toString();
  }, [stage, q, state, type, tag, minScore, hasEmail, sort, dir, page]);

  const { data, isLoading, error, mutate } = useApi<ListResponse>(`/api/companies?${query}`);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [tagging, setTagging] = useState<string[] | null>(null);
  const [tagValue, setTagValue] = useState('');
  const [deleting, setDeleting] = useState<string[] | null>(null);

  const counts = data?.counts;
  const filtersActive = !!(q || state || type || tag || minScore || hasEmail);
  const exportQs = query.replace(/(^|&)(limit|offset|facets|sort|dir)=[^&]*/g, '').replace(/^&/, '');

  const bulk = async (body: Record<string, unknown>, done: string, clear: () => void) => {
    try {
      const res = await apiPost<{ affected: number }>('/api/companies/bulk', body);
      toast.success(done.replace('{n}', String(res.affected)));
      clear();
      setSelected([]);
      await mutate();
      void invalidate('/api/companies');
      void invalidate('/api/dashboard');
    } catch (e) { toast.error('Bulk action failed', errMsg(e)); }
  };

  const columns: DataTableColumn<CompanyListRow>[] = [
    {
      key: 'name', header: 'Company', sortable: true, mobile: 'title',
      cell: (c) => (
        <div className="crm-namecell">
          <Avatar name={c.name} square size="sm" />
          <div className="crm-namecell__text">
            <span className="crm-namecell__name">{c.name}</span>
            <span className="crm-namecell__sub">{c.domain ?? (c.top_contact_name ? c.top_contact_name : 'No website')}</span>
          </div>
        </div>
      ),
    },
    { key: 'stage', header: 'Stage', sortable: true, cell: (c) => <StageBadge stage={c.stage} /> },
    { key: 'score', header: 'Score', sortable: true, cell: (c) => <ScorePill score={c.score} /> },
    { key: 'units', header: 'Portfolio', sortable: true, cell: (c) => <span style={{ whiteSpace: 'nowrap' }}>{portfolio(c) ?? <span className="subtle">—</span>}</span> },
    { key: 'location', header: 'Location', cell: (c) => <span style={{ whiteSpace: 'nowrap' }}>{location(c) || <span className="subtle">—</span>}</span>, muted: true },
    { key: 'spend', header: 'Est. water spend', sortable: true, align: 'right', cell: (c) => <span className="num">{fmtMoney(c.est_annual_water_spend, { compact: true })}</span> },
    { key: 'last_activity', header: 'Last activity', sortable: true, muted: true, cell: (c) => relTime(c.last_activity_at) },
    {
      key: 'follow_up', header: 'Next follow-up', sortable: true,
      cell: (c) => c.next_follow_up_at
        ? <span className={isOverdue(c.next_follow_up_at) ? 'crm-overdue' : undefined}>{relTime(c.next_follow_up_at)}</span>
        : <span className="subtle">—</span>,
    },
  ];

  const mobileCard = (c: CompanyListRow) => (
    <div className="crm-card">
      <div className="crm-card__top">
        <Avatar name={c.name} square />
        <div className="grow">
          <div className="crm-namecell__name" style={{ whiteSpace: 'normal' }}>{c.name}</div>
          <div className="crm-namecell__sub">{[c.domain, location(c)].filter(Boolean).join(' · ') || 'No details yet'}</div>
        </div>
        <ScorePill score={c.score} />
      </div>
      <div className="row-between">
        <StageBadge stage={c.stage} />
        {c.has_email && <span className="text-xs subtle row" style={{ gap: 4 }}><Mail size={12} /> email</span>}
      </div>
      <dl className="crm-card__meta">
        <div><dt>Portfolio</dt><dd>{portfolio(c) ?? '—'}</dd></div>
        <div><dt>Est. water spend</dt><dd>{fmtMoney(c.est_annual_water_spend, { compact: true })}</dd></div>
        <div><dt>Last activity</dt><dd>{relTime(c.last_activity_at)}</dd></div>
        <div><dt>Next follow-up</dt><dd className={c.next_follow_up_at && isOverdue(c.next_follow_up_at) ? 'crm-overdue' : undefined}>{c.next_follow_up_at ? relTime(c.next_follow_up_at) : '—'}</dd></div>
      </dl>
    </div>
  );

  const stageTabs = [{ value: 'all', label: 'All' }, ...STAGES.map((s) => ({ value: s.key, label: STAGE_LABELS[s.key as Stage] === 'New lead' ? 'New' : s.label }))]
    .map((t) => ({ ...t, count: counts ? counts[t.value] ?? 0 : null }));

  const sortState: SortState = { key: sort, dir: dir === 'asc' ? 'asc' : 'desc' };
  const check = (on: boolean) => (on ? '✓ ' : '');
  const stateItems: MenuItem[] = [{ label: `${check(!state)}All states`, onSelect: () => setParams({ state: null }) }, ...(data?.facets.states ?? []).map((s) => ({ label: `${check(state === s.value)}${s.value}`, hint: s.n, onSelect: () => setParams({ state: s.value }) }))];
  const typeItems: MenuItem[] = [{ label: `${check(!type)}All types`, onSelect: () => setParams({ type: null }) }, ...COMPANY_TYPES.filter((t) => t !== 'unknown').map((t) => ({ label: `${check(type === t)}${COMPANY_TYPE_LABELS[t]}`, onSelect: () => setParams({ type: t }) }))];
  const scoreItems: MenuItem[] = SCORE_OPTIONS.map((n) => ({ label: `${check(minScore === n)}${n ? `${n}+` : 'Any score'}`, onSelect: () => setParams({ minScore: String(n) }) }));
  const tagItems: MenuItem[] = [{ label: `${check(!tag)}All tags`, onSelect: () => setParams({ tag: null }) }, ...(data?.facets.tags ?? []).map((t) => ({ label: `${check(tag === t.value)}${t.value}`, hint: t.n, onSelect: () => setParams({ tag: t.value }) }))];

  const total = data?.total ?? 0;
  const empty = !isLoading && !error && data && total === 0;
  const noCompaniesAtAll = empty && !filtersActive && stage === 'all';

  return (
    <div className="page">
      <PageHeader
        title="Companies"
        subtitle={counts ? `${(counts.all ?? 0).toLocaleString()} ${counts.all === 1 ? 'company' : 'companies'}${stage !== 'all' ? ` · ${total} in ${STAGE_LABELS[stage as Stage] ?? stage}` : ''}` : 'Owners and property managers'}
        actions={
          <>
            <Button icon={Upload} onClick={() => setImporting(true)} className="hide-mobile">Import</Button>
            <Button icon={Download} href={`/api/export/companies.csv${exportQs ? `?${exportQs}` : ''}`} className="hide-mobile">Export</Button>
            <Menu
              className="hide-desktop" aria-label="More actions"
              trigger={<IconButton icon={MoreHorizontal} label="More actions" variant="secondary" />}
              items={[{ label: 'Import CSV', icon: Upload, onSelect: () => setImporting(true) }, { label: 'Export CSV', icon: Download, href: `/api/export/companies.csv${exportQs ? `?${exportQs}` : ''}` }]}
            />
            <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add company</Button>
          </>
        }
      />

      <div className="crm-tabs-scroll" style={{ marginBottom: 14 }}>
        <Tabs aria-label="Pipeline stage" items={stageTabs} value={stage} onChange={(v) => setParams({ stage: v === 'all' ? null : v })} />
      </div>

      <div className="crm-toolbar">
        <div className="crm-toolbar__row">
          <SearchInput className="crm-toolbar__search" value={q} debounce={250} onChange={(v) => setParams({ q: v })} placeholder="Search companies, domains, contacts" shortcut="/" />
        </div>
        <div className="crm-filters crm-filters--scroll">
          <Menu align="start" trigger={<Button size="sm" className="crm-filterbtn">State{state ? `: ${state}` : ''}</Button>} items={stateItems} />
          <Menu align="start" trigger={<Button size="sm" className="crm-filterbtn">Type{type ? `: ${COMPANY_TYPE_LABELS[type as keyof typeof COMPANY_TYPE_LABELS] ?? type}` : ''}</Button>} items={typeItems} />
          <Menu align="start" trigger={<Button size="sm" className="crm-filterbtn">Score{minScore ? ` ≥ ${minScore}` : ''}</Button>} items={scoreItems} />
          {(data?.facets.tags.length ?? 0) > 0 && <Menu align="start" trigger={<Button size="sm" className="crm-filterbtn" icon={Tag}>{tag ? tag : 'Tag'}</Button>} items={tagItems} />}
          <Chip selected={hasEmail} onClick={() => setParams({ hasEmail: hasEmail ? null : '1' })} icon={Mail}>Has email</Chip>
          {filtersActive && <Button size="sm" variant="ghost" icon={X} className="crm-filterbtn" onClick={() => router.replace(stage !== 'all' ? `${pathname}?stage=${stage}` : pathname, { scroll: false })}>Clear</Button>}
        </div>
      </div>

      {error && !data ? (
        <EmptyState icon={Building2} title="Couldn't load companies" description={errMsg(error)} actions={<Button onClick={() => void mutate()}>Try again</Button>} bordered />
      ) : noCompaniesAtAll ? (
        <EmptyState
          bordered icon={Building2} title="No companies yet"
          description="Add your first owner or property manager, import a spreadsheet, or let the research engine find leads."
          actions={<><Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add company</Button><Button icon={Upload} onClick={() => setImporting(true)}>Import CSV</Button><Button icon={Search} href="/leads">Find leads</Button></>}
        />
      ) : empty ? (
        <EmptyState
          bordered icon={Search} title="No companies match" description="Try a different stage or clear your filters."
          actions={<Button onClick={() => router.replace(pathname, { scroll: false })}>Clear filters</Button>}
        />
      ) : (
        <DataTable
          aria-label="Companies"
          rows={data?.rows ?? []} columns={columns} getRowId={(c) => c.id} rowHref={(c) => `/companies/${c.id}`}
          loading={isLoading && !data} selectable selected={selected} onSelectedChange={setSelected}
          sort={sortState} onSortChange={(s) => setParams({ sort: s.key, dir: s.dir })}
          mobileCard={mobileCard}
          bulkActions={(ids, clear) => (
            <>
              <Menu
                trigger={<Button size="sm">Change stage</Button>}
                items={STAGES.map((s) => ({ label: s.label, onSelect: () => void bulk({ action: 'stage', ids, stage: s.key }, `Moved {n} to ${s.label}`, clear) }))}
              />
              <Button size="sm" icon={Tag} onClick={() => { setTagValue(''); setTagging(ids); }}>Add tag</Button>
              <Button size="sm" icon={Megaphone} href={`/campaigns/new?companyIds=${ids.join(',')}`}>Add to campaign</Button>
              <Button size="sm" variant="danger" icon={Trash2} onClick={() => setDeleting(ids)}>Delete</Button>
            </>
          )}
          footer={<Pager offset={page * LIMIT} limit={LIMIT} total={total} onChange={(o) => setParams({ page: String(o / LIMIT) })} />}
        />
      )}

      <CompanySheet open={adding} onClose={() => setAdding(false)} onSaved={(c) => router.push(`/companies/${c.id}`)} />
      <ImportModal open={importing} onClose={() => setImporting(false)} onDone={() => void mutate()} />

      <Modal
        open={!!tagging} onClose={() => setTagging(null)} size="sm" title="Add tag" description={`Tag ${tagging?.length ?? 0} selected ${tagging?.length === 1 ? 'company' : 'companies'}.`}
        footer={<><Button variant="ghost" onClick={() => setTagging(null)}>Cancel</Button><Button variant="primary" disabled={!tagValue.trim()} onClick={() => { const ids = tagging!; setTagging(null); void bulk({ action: 'add_tag', ids, tag: tagValue.trim() }, 'Tagged {n}', () => undefined); }}>Add tag</Button></>}
      >
        <Input autoFocus value={tagValue} placeholder="e.g. NJ pilot" onChange={(e) => setTagValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && tagValue.trim()) { const ids = tagging!; setTagging(null); void bulk({ action: 'add_tag', ids, tag: tagValue.trim() }, 'Tagged {n}', () => undefined); } }} />
      </Modal>
      <ConfirmModal
        open={!!deleting} onClose={() => setDeleting(null)} title={`Delete ${deleting?.length ?? 0} ${deleting?.length === 1 ? 'company' : 'companies'}?`}
        description="This also removes their tasks and activity. Contacts and properties are kept but unlinked."
        onConfirm={() => bulk({ action: 'delete', ids: deleting! }, 'Deleted {n}', () => undefined)}
      />
    </div>
  );
}

