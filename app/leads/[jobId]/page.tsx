'use client';

import Link from 'next/link';
import { use, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Building2, CheckCircle2, Droplets, ExternalLink, Globe, Linkedin, Mail, MapPin, Phone, Search, Star, Users, X } from 'lucide-react';
import { apiPost, invalidate, useApi } from '@/lib/client/api';
import { Badge, Button, Card, EmptyState, KeyValue, PageHeader, ProgressBar, ScorePill, Sheet, Skeleton, Spinner, Tabs, formatMoney, formatNumber, formatRelative, useToast } from '@/app/ui';
import '../leads.css';

type Contact = { name: string; title: string | null; role: string; decisionMaker: boolean; email: string | null; emailStatus: 'published' | 'inferred' | null; phone: string | null; linkedin: string | null; lookup: { contactout: string } };
type Utility = { name: string; pwsid: string; buildings: number; meter: { status: string; label: string; detail: string; source: string | null }; angle: string };
type Signal = { kind: string; severity: string; detail: string };
type Candidate = {
  id: string;
  name: string;
  score: number | null;
  status: 'new' | 'saved' | 'dismissed';
  companyId: string | null;
  researchStatus: 'pending' | 'enriching' | 'done';
  confidence: string | null;
  type: string;
  nameConfidence: number;
  portfolio: { buildings: number; units: number; unitsEstimated: boolean; avgYearBuilt: number | null; states: string[]; claimedUnits: number | null; claimedBuildings: number | null };
  contacts: Contact[];
  phone: string | null;
  email: string | null;
  website: string | null;
  linkedin: string | null;
  water: { estAnnualSpend: number | null; estMonthlySpend: number | null; utilities: Utility[] };
  signals: Signal[];
  why: string[];
  gaps: string[];
  sources: { id: string; name: string; hits: number }[];
};
type Job = { id: string; kind: string; title: string; status: string; progress: number; stage: string | null; stats: Record<string, number>; error: string | null; log: { at: string; level: string; message: string }[]; created_at: string; target_company_id: string | null };
type Dossier = {
  buildings: { key: string; address: string; city: string | null; state: string; units: number | null; unitsEstimated: boolean; yearBuilt: number | null; ownerName: string | null; utilityName: string | null; estAnnualWaterCost: number | null; reportedWaterKgal: number | null }[];
  people: { key: string; name: string; title: string | null; role: string; decisionMaker: boolean; emails: { email: string; status: string; confidence: number }[]; phones: { phone: string }[]; linkedin: string | null; org: string | null; src: string[] }[];
  phones: { phone: string; label: string }[];
  emails: { email: string; status: string }[];
  addresses: { text: string; kind: string; count: number }[];
  aliases: { name: string; kind: string; count: number }[];
  managers: { name: string; buildings: number }[];
  trail: string[];
  signals: Signal[];
  water: { estAnnualSpend: number | null; estMonthlySpend: number | null; basis: string | null; reportedKgal: number | null; utilities: Utility[] };
  scoreFactors: { id: string; label: string; points: number; max: number; detail: string }[];
  links: Record<string, string>;
};

const TYPE_LABEL: Record<string, string> = { property_manager: 'Property manager', owner_operator: 'Owner-operator', public_housing: 'Housing authority', nonprofit: 'Nonprofit', reit: 'REIT', developer: 'Developer', investor: 'Investor', other: 'Other', unknown: 'Owner' };

export default function LeadJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params);
  const toast = useToast();
  const [tab, setTab] = useState('new');
  const [selected, setSelected] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { data, mutate, isLoading } = useApi<{ job: Job; candidates: Candidate[] }>(`/api/research/jobs/${jobId}`, { refreshInterval: (latest) => (latest?.job.status === 'running' || latest?.job.status === 'queued' ? 3000 : 0) });
  const pumping = useRef(false);
  const running = data?.job.status === 'running' || data?.job.status === 'queued';

  // Keep research moving while the page is open (the cron tick continues it otherwise).
  useEffect(() => {
    if (!running) return;
    let alive = true;
    const loop = async () => {
      if (pumping.current) return;
      pumping.current = true;
      try {
        while (alive && document.visibilityState === 'visible') {
          const r = await apiPost<{ status: string }>(`/api/research/jobs/${jobId}/pump`).catch(() => null);
          await mutate();
          if (!r || (r.status !== 'running' && r.status !== 'queued')) break;
        }
      } finally {
        pumping.current = false;
      }
    };
    void loop();
    const onVis = () => void loop();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [running, jobId, mutate]);

  const job = data?.job;
  const all = data?.candidates ?? [];
  const list = all.filter((c) => (tab === 'saved' ? c.status === 'saved' : c.status !== 'saved'));

  const save = async (ids: string[]) => {
    setBusy(ids.length === 1 ? ids[0] : 'bulk');
    try {
      if (ids.length === 1) {
        const r = await apiPost<{ companyId: string; contacts: number; properties: number }>(`/api/leads/${ids[0]}/save`);
        toast.success('Saved to Companies', `${r.contacts} contacts and ${r.properties} buildings added`);
      } else {
        const r = await apiPost<{ saved: number }>('/api/leads/save-bulk', { ids });
        toast.success(`${r.saved} leads saved to Companies`);
      }
      setSelected([]);
      await mutate();
      await invalidate('/api/companies');
    } catch (e) {
      toast.error('Could not save', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async (id: string) => {
    await apiPost(`/api/leads/${id}/dismiss`).catch(() => undefined);
    await mutate();
  };

  const cancel = async () => {
    await apiPost(`/api/research/jobs/${jobId}/cancel`).catch(() => undefined);
    await mutate();
  };

  if (isLoading && !data) return <div className="page"><Skeleton height={140} /></div>;
  if (!job) return <div className="page"><EmptyState title="Search not found" actions={<Button href="/leads">Back to Find leads</Button>} /></div>;

  return (
    <div className="page">
      <PageHeader
        back={{ href: '/leads', label: 'Find leads' }}
        title={job.title}
        subtitle={`${formatRelative(job.created_at)} · ${job.stage ?? job.status}`}
        actions={running ? <Button variant="ghost" icon={X} onClick={cancel}>Stop</Button> : <Button href="/leads" icon={Search}>New search</Button>}
      />

      {(running || job.status === 'failed') && (
        <Card className="lead-progress">
          <ProgressBar value={job.progress} tone="accent" label={job.stage ?? 'Starting'} />
          <div className="lead-log" aria-live="polite">
            {(job.log ?? []).slice(-14).reverse().map((l, i) => (
              <span key={`${l.at}-${i}`} className={l.level === 'success' ? 'ok' : l.level === 'warn' ? 'warn' : l.level === 'error' ? 'err' : ''}>{l.message}</span>
            ))}
          </div>
        </Card>
      )}

      <div className="row-between" style={{ marginBottom: 12 }}>
        <Tabs value={tab} onChange={setTab} items={[{ value: 'new', label: 'Leads', count: all.filter((c) => c.status !== 'saved').length }, { value: 'saved', label: 'Saved', count: all.filter((c) => c.status === 'saved').length }]} />
        {selected.length > 0 && <Button variant="primary" loading={busy === 'bulk'} onClick={() => save(selected)}>Save {selected.length} to CRM</Button>}
      </div>

      {!list.length ? (
        running ? <EmptyState icon={<Spinner />} title="Researching…" description="Leads appear here as each portfolio is cross-referenced." bordered /> : <EmptyState icon={Search} title={tab === 'saved' ? 'Nothing saved yet' : 'No leads matched'} description={tab === 'saved' ? 'Save leads to add them to Companies.' : 'Try a lower minimum unit count or a wider area.'} bordered />
      ) : (
        <div className="lead-list">
          {list.map((c) => {
            const top = c.contacts.find((p) => p.decisionMaker) ?? c.contacts[0];
            const units = Math.max(c.portfolio.units, c.portfolio.claimedUnits ?? 0);
            const buildings = Math.max(c.portfolio.buildings, c.portfolio.claimedBuildings ?? 0);
            return (
              <Card key={c.id} className="lead-card">
                <div className="lead-card__top">
                  {c.status !== 'saved' && <input type="checkbox" className="lead-select" aria-label={`Select ${c.name}`} checked={selected.includes(c.id)} onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id)))} />}
                  <div className="stack-sm grow" style={{ minWidth: 0 }}>
                    <button type="button" className="lead-card__name link" style={{ textAlign: 'left' }} onClick={() => setOpenId(c.id)}>{c.name}</button>
                    <div className="lead-card__meta">
                      <span>{TYPE_LABEL[c.type] ?? 'Owner'}</span>
                      <span><Building2 size={14} />{formatNumber(buildings)} bldg · {formatNumber(units)} units{c.portfolio.unitsEstimated ? '*' : ''}</span>
                      {c.water.estMonthlySpend ? <span><Droplets size={14} />~{formatMoney(c.water.estMonthlySpend)}/mo water</span> : null}
                      {c.water.utilities[0] && <span title={c.water.utilities[0].meter.detail}>{c.water.utilities[0].name} · {c.water.utilities[0].meter.label}</span>}
                      {c.portfolio.states.length > 0 && <span><MapPin size={14} />{c.portfolio.states.join(', ')}</span>}
                      {c.researchStatus !== 'done' && <span><Spinner /> researching</span>}
                    </div>
                  </div>
                  <ScorePill score={c.score} title={c.confidence ? `${c.confidence} confidence` : undefined} />
                </div>
                {top && (
                  <div className="lead-card__contact">
                    <Users size={14} />
                    <strong>{top.name}</strong>
                    {top.title && <span className="subtle">{top.title}</span>}
                    {top.email && <a className="link" href={`mailto:${top.email}`}><Mail size={13} /> {top.email}</a>}
                    {top.emailStatus === 'inferred' && <Badge tone="warning">inferred</Badge>}
                    {(top.phone ?? c.phone) && <a className="link" href={`tel:${top.phone ?? c.phone}`}><Phone size={13} /> {top.phone ?? c.phone}</a>}
                  </div>
                )}
                {c.why.length > 0 && <ul className="lead-card__why">{c.why.slice(0, 3).map((w) => <li key={w}>{w}</li>)}</ul>}
                {c.signals.length > 0 && <div className="signal"><AlertTriangle size={14} color="var(--warning)" /><span>{c.signals[0].detail}{c.signals.length > 1 ? ` (+${c.signals.length - 1} more)` : ''}</span></div>}
                <div className="row-between">
                  <div className="row-wrap" style={{ gap: 6 }}>
                    {c.sources.slice(0, 6).map((s) => <Badge key={s.id} outline>{s.name.replace(/\s*\(.*\)$/, '')}</Badge>)}
                  </div>
                  <div className="lead-card__actions">
                    <Button size="sm" variant="ghost" onClick={() => setOpenId(c.id)}>Details</Button>
                    {c.status === 'saved' && c.companyId ? (
                      <Button size="sm" href={`/companies/${c.companyId}`} icon={CheckCircle2}>Open company</Button>
                    ) : (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => dismiss(c.id)}>Dismiss</Button>
                        <Button size="sm" variant="primary" loading={busy === c.id} onClick={() => save([c.id])}>Save to CRM</Button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <LeadSheet jobId={jobId} candidateId={openId} onClose={() => setOpenId(null)} onSave={(id) => save([id])} />
    </div>
  );
}

function LeadSheet({ jobId, candidateId, onClose, onSave }: { jobId: string; candidateId: string | null; onClose: () => void; onSave: (id: string) => void }) {
  const { data } = useApi<{ candidate: Candidate & { dossier: Dossier } }>(candidateId ? `/api/research/jobs/${jobId}?candidate=${candidateId}` : null);
  const c = data?.candidate;
  const d = c?.dossier;
  return (
    <Sheet open={Boolean(candidateId)} onClose={onClose} size="xl" title={c?.name ?? 'Lead'} description={c ? `${TYPE_LABEL[c.type] ?? 'Owner'} · score ${c.score ?? '—'}${c.confidence ? ` (${c.confidence} confidence)` : ''}` : undefined}
      footer={c && c.status !== 'saved' ? <Button variant="primary" onClick={() => onSave(c.id)}>Save to CRM</Button> : c?.companyId ? <Button href={`/companies/${c.companyId}`}>Open company</Button> : undefined}>
      {!d ? <Skeleton height={300} /> : (
        <div>
          <section className="dossier-section">
            <h3 className="section-title">Company</h3>
            <KeyValue items={[
              { label: 'Website', value: c!.website ?? '—', href: c!.website ?? undefined },
              { label: 'Main phone', value: d.phones[0] ? `${d.phones[0].phone} (${d.phones[0].label})` : '—', copy: d.phones[0]?.phone },
              { label: 'Email', value: d.emails.find((e) => e.status === 'published')?.email ?? '—' },
              { label: 'Office / mailing', value: d.addresses.slice(0, 2).map((a) => a.text).join(' · ') || '—' },
              { label: 'Also known as', value: d.aliases.slice(0, 5).map((a) => a.name).join(', ') || '—' },
              { label: 'Managed by', value: d.managers.slice(0, 3).map((m) => `${m.name} (${m.buildings})`).join(', ') || '—', hidden: !d.managers.length },
              { label: 'LinkedIn', value: c!.linkedin ?? '—', href: c!.linkedin ?? undefined, hidden: !c!.linkedin },
              { label: 'ContactOut', value: d.links?.contactout ? 'Company profile' : '—', href: d.links?.contactout, hidden: !d.links?.contactout },
            ]} />
          </section>

          <section className="dossier-section">
            <h3 className="section-title">Decision makers & contacts</h3>
            {!d.people.length ? <p className="subtle">Nobody named yet.</p> : d.people.slice(0, 15).map((p) => (
              <div key={p.key} className="dossier-person">
                {p.decisionMaker ? <Star size={16} color="var(--accent)" /> : <Users size={16} className="subtle" />}
                <div className="stack-sm grow" style={{ minWidth: 0 }}>
                  <strong>{p.name}</strong>
                  <span className="subtle text-sm">{[p.title, p.org].filter(Boolean).join(' · ') || p.role}</span>
                  <div className="row-wrap text-sm" style={{ gap: 10 }}>
                    {p.emails.slice(0, 2).map((e) => <span key={e.email}><Mail size={12} /> {e.email} {e.status === 'inferred' && <Badge tone="warning">inferred {Math.round(e.confidence * 100)}%</Badge>}</span>)}
                    {p.phones.slice(0, 1).map((ph) => <span key={ph.phone}><Phone size={12} /> {ph.phone}</span>)}
                    {p.linkedin && <a className="link" href={p.linkedin} target="_blank" rel="noreferrer"><Linkedin size={12} /> LinkedIn</a>}
                    <a className="link" href={c!.contacts.find((x) => x.name === p.name)?.lookup.contactout ?? `https://www.google.com/search?q=${encodeURIComponent(`site:contactout.com "${p.name}"`)}`} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Find on ContactOut</a>
                  </div>
                  <span className="subtle text-xs">Sources: {p.src.join(', ')}</span>
                </div>
              </div>
            ))}
          </section>

          <section className="dossier-section">
            <h3 className="section-title">Water & utilities</h3>
            <KeyValue items={[
              { label: 'Est. water + sewer', value: d.water.estAnnualSpend ? `${formatMoney(d.water.estMonthlySpend ?? 0)}/month · ${formatMoney(d.water.estAnnualSpend)}/year` : '—' },
              { label: 'Reported use (LL84)', value: d.water.reportedKgal ? `${formatNumber(d.water.reportedKgal)} kgal/yr` : '—', hidden: !d.water.reportedKgal },
              { label: 'Basis', value: d.water.basis ?? '—' },
            ]} />
            {d.water.utilities.map((u) => (
              <Card key={u.pwsid}>
                <div className="stack-sm">
                  <div className="row-between"><strong><Droplets size={14} /> {u.name}</strong><Badge tone={u.meter.status === 'unknown' ? 'neutral' : 'info'}>{u.meter.label}</Badge></div>
                  <span className="subtle text-sm">{u.buildings} building{u.buildings === 1 ? '' : 's'} · PWSID {u.pwsid}</span>
                  <span className="text-sm">{u.meter.detail}</span>
                  <span className="text-sm"><strong>Angle:</strong> {u.angle}</span>
                  {u.meter.source && <a className="link text-sm" href={u.meter.source} target="_blank" rel="noreferrer">Utility source</a>}
                </div>
              </Card>
            ))}
          </section>

          {d.signals.length > 0 && (
            <section className="dossier-section">
              <h3 className="section-title">Payment & risk signals</h3>
              {d.signals.map((s) => <div key={s.detail} className="signal"><AlertTriangle size={14} color={s.severity === 'high' ? 'var(--danger)' : 'var(--warning)'} /><span>{s.detail}</span></div>)}
            </section>
          )}

          <section className="dossier-section">
            <h3 className="section-title">Buildings ({d.buildings.length})</h3>
            <div className="dossier-scroll">
              <table className="dossier-buildings">
                <thead><tr><th>Address</th><th>Units</th><th>Built</th><th>Utility</th><th>Est. water/mo</th></tr></thead>
                <tbody>
                  {[...d.buildings].sort((a, b) => (b.units ?? 0) - (a.units ?? 0)).slice(0, 60).map((b) => (
                    <tr key={b.key}>
                      <td>{b.address}{b.city ? `, ${b.city}` : ''} {b.state}<br /><span className="subtle text-xs">{b.ownerName ?? ''}</span></td>
                      <td>{b.units ?? '—'}{b.unitsEstimated ? '*' : ''}</td>
                      <td>{b.yearBuilt ?? '—'}</td>
                      <td>{b.utilityName ?? '—'}</td>
                      <td>{b.estAnnualWaterCost ? formatMoney(Math.round(b.estAnnualWaterCost / 12)) : '—'}{b.reportedWaterKgal ? ' (reported)' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="dossier-section">
            <h3 className="section-title">Score</h3>
            {d.scoreFactors.map((f) => <ProgressBar key={f.id} value={(f.points / f.max) * 100} size="sm" label={`${f.label} · ${f.points}/${f.max}`} valueLabel={f.detail} />)}
          </section>

          <section className="dossier-section">
            <h3 className="section-title">How Puma found this</h3>
            <ol className="dossier-trail">{d.trail.map((t) => <li key={t}>{t}</li>)}</ol>
            {c!.gaps.length > 0 && <p className="subtle text-sm"><Globe size={12} /> Still missing: {c!.gaps.join(' · ')}</p>}
          </section>
        </div>
      )}
    </Sheet>
  );
}
