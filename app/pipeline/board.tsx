'use client';

import { Building2, ChevronsRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Button, EmptyState, FilterChips, IconButton, Menu, PageHeader, ScorePill, SearchInput, Skeleton, STAGES, useToast } from '@/app/ui';
import { apiPost, invalidate, useApi } from '@/lib/client/api';
import { fmtMoney, fmtNumber, isOverdue, relTime } from '@/lib/crm/format';
import type { CompanyListRow } from '@/lib/crm/types';
import { errMsg } from '@/lib/crm/ui/common';
import { CompanySheet } from '@/lib/crm/ui/forms';

type Resp = { rows: CompanyListRow[]; total: number; counts: Record<string, number>; sums: Record<string, { units: number; spend: number }> };

export function PipelineBoard() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const { data, error, isLoading, mutate } = useApi<Resp>(`/api/companies?limit=200&sort=score&dir=desc${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [active, setActive] = useState('new');
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => (data?.rows ?? []).map((c) => (moved[c.id] ? { ...c, stage: moved[c.id] as CompanyListRow['stage'] } : c)), [data, moved]);
  const byStage = useMemo(() => {
    const m: Record<string, CompanyListRow[]> = {};
    for (const s of STAGES) m[s.key] = [];
    for (const c of rows) m[c.stage]?.push(c);
    return m;
  }, [rows]);

  const move = async (id: string, stage: string) => {
    const current = rows.find((r) => r.id === id);
    if (!current || current.stage === stage) return;
    const from = current.stage;
    setMoved((m) => ({ ...m, [id]: stage }));
    try {
      await apiPost(`/api/companies/${id}/stage`, { stage });
      toast.toast({ title: `${current.name} moved to ${STAGES.find((s) => s.key === stage)?.label}`, tone: 'success', action: { label: 'Undo', onClick: () => void move(id, from) } });
      await mutate();
      setMoved((m) => { const n = { ...m }; delete n[id]; return n; });
      void invalidate('/api/companies');
      void invalidate('/api/dashboard');
    } catch (e) {
      setMoved((m) => { const n = { ...m }; delete n[id]; return n; });
      toast.error('Could not move company', errMsg(e));
    }
  };

  // Totals use server-side stage sums (the board only loads the top 200), adjusted for optimistic moves.
  const total = (stage: string) => {
    const base = data?.sums?.[stage] ?? { units: 0, spend: 0 };
    let count = data?.counts?.[stage] ?? 0;
    let units = base.units;
    let spend = base.spend;
    for (const [id, to] of Object.entries(moved)) {
      const orig = data?.rows.find((r) => r.id === id);
      if (!orig || orig.stage === to) continue;
      if (orig.stage === stage) { count -= 1; units -= orig.portfolio_units ?? 0; spend -= orig.est_annual_water_spend ?? 0; }
      if (to === stage) { count += 1; units += orig.portfolio_units ?? 0; spend += orig.est_annual_water_spend ?? 0; }
    }
    return { count, units, spend };
  };

  const empty = !isLoading && !error && data && data.counts.all === 0 && !q;

  return (
    <div className="page page--wide">
      <PageHeader title="Pipeline" subtitle={data ? `${data.counts.all ?? 0} companies · drag a card to change its stage` : 'Track every lead from first touch to client'}
        actions={<Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add company</Button>} />
      <div className="crm-toolbar"><SearchInput className="crm-toolbar__search" value={q} debounce={250} onChange={setQ} placeholder="Filter the board" /></div>

      {error && !data ? <EmptyState bordered icon={Building2} title="Couldn't load the pipeline" description={errMsg(error)} actions={<Button onClick={() => void mutate()}>Try again</Button>} />
        : empty ? <EmptyState bordered icon={Building2} title="Your pipeline is empty" description="Add a company or find leads with the research engine to start tracking deals." actions={<><Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add company</Button><Button href="/leads">Find leads</Button></>} />
        : (
          <>
            <div className="crm-stagepicker">
              <FilterChips aria-label="Stage" value={active} onChange={setActive} options={STAGES.map((s) => ({ value: s.key, label: s.label === 'New lead' ? 'New' : s.label, count: data?.counts[s.key] ?? 0 }))} />
            </div>
            <div className="crm-board-wrap">
              <div className="crm-board">
                {STAGES.map((s) => {
                  const t = total(s.key);
                  const list = byStage[s.key] ?? [];
                  return (
                    <section
                      key={s.key} className="crm-col-board" data-active={active === s.key} data-over={over === s.key} aria-label={s.label}
                      onDragOver={(e) => { if (dragId) { e.preventDefault(); setOver(s.key); } }}
                      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === s.key ? null : o)); }}
                      onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain') || dragId; setOver(null); setDragId(null); if (id) void move(id, s.key); }}
                    >
                      <header className="crm-col-board__head">
                        <div className="crm-col-board__title"><i style={{ background: s.color }} />{s.label}<span className="crm-col-board__count">{t.count}</span></div>
                        <div className="crm-col-board__sum"><span>{fmtNumber(t.units)} units</span><span>{fmtMoney(t.spend, { compact: true })} / yr</span></div>
                      </header>
                      <div className="crm-col-board__list">
                        {isLoading && !data ? [0, 1, 2].map((i) => <Skeleton key={i} height={92} radius={10} />) : list.length === 0 ? (
                          <p className="text-sm subtle" style={{ padding: '14px 6px', textAlign: 'center' }}>{q ? 'No matches' : 'Drop a company here'}</p>
                        ) : list.map((c) => (
                          <Link
                            key={c.id} href={`/companies/${c.id}`} className="crm-deal" draggable data-dragging={dragId === c.id}
                            onDragStart={(e) => { e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed = 'move'; setDragId(c.id); }}
                            onDragEnd={() => { setDragId(null); setOver(null); }}
                          >
                            <div className="crm-deal__top">
                              <span className="crm-deal__name grow">{c.name}</span>
                              <ScorePill score={c.score} />
                              <span onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                                <Menu
                                  aria-label={`Move ${c.name}`}
                                  trigger={<IconButton size="sm" icon={ChevronsRight} label="Move to stage" />}
                                  items={[{ heading: 'Move to' }, ...STAGES.filter((x) => x.key !== c.stage).map((x) => ({ label: x.label, onSelect: () => void move(c.id, x.key) }))]}
                                />
                              </span>
                            </div>
                            <div className="crm-deal__meta">
                              {c.portfolio_units != null && <span>{fmtNumber(c.portfolio_units)} units</span>}
                              {(c.city || c.state) && <span>{[c.city, c.state].filter(Boolean).join(', ')}</span>}
                              {c.est_annual_water_spend != null && <span>{fmtMoney(c.est_annual_water_spend, { compact: true })}/yr</span>}
                            </div>
                            <div className="crm-deal__foot">
                              <span>{c.top_contact_name ?? 'No contact'}</span>
                              <span className={c.next_follow_up_at && isOverdue(c.next_follow_up_at) ? 'crm-overdue' : undefined}>{c.next_follow_up_at ? `Follow-up ${relTime(c.next_follow_up_at)}` : relTime(c.last_activity_at)}</span>
                            </div>
                          </Link>
                        ))}
                        {(data?.counts[s.key] ?? 0) > list.length && !q && <Link className="text-sm muted" style={{ padding: 8, textAlign: 'center' }} href={`/companies?stage=${s.key}`}>View all {data?.counts[s.key]}</Link>}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          </>
        )}
      <CompanySheet open={adding} onClose={() => setAdding(false)} onSaved={() => void mutate()} />
    </div>
  );
}
