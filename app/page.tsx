'use client';

import { useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Building2,
  ChevronRight,
  CircleDollarSign,
  Database,
  Droplets,
  Gauge,
  LayoutDashboard,
  MapPinned,
  RadioTower,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  UsersRound,
  Waves,
  X,
} from 'lucide-react';
import { INGESTION_SOURCES, PROSPECTS, UTILITIES } from '@/lib/data';
import { scoreBand, scoreBreakdown, scoreProspect } from '@/lib/scoring';
import type { Prospect, StateCode } from '@/lib/types';

type View = 'dashboard' | 'prospects' | 'utilities' | 'monitor' | 'engine';

const nav: { id: View; label: string; icon: LucideIcon }[] = [
  { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
  { id: 'prospects', label: 'Prospects', icon: Target },
  { id: 'utilities', label: 'Utilities', icon: Waves },
  { id: 'monitor', label: 'Monitor', icon: Activity },
  { id: 'engine', label: 'Engine', icon: Database },
];

const formatMoney = (value: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
}).format(value);

function ScorePill({ score }: { score: number }) {
  const band = scoreBand(score);
  return <span className={`score-pill ${band.toLowerCase()}`}>{score}<small>{band}</small></span>;
}

function MetricCard({ icon: Icon, label, value, note }: { icon: LucideIcon; label: string; value: string; note: string }) {
  return (
    <article className="metric-card">
      <div className="metric-icon"><Icon size={18} /></div>
      <div><p>{label}</p><strong>{value}</strong><span>{note}</span></div>
    </article>
  );
}

function SourceBadge({ confidence }: { confidence: Prospect['confidence'] }) {
  return <span className="source-badge"><ShieldCheck size={12} />{confidence}</span>;
}

export default function Home() {
  const [view, setView] = useState<View>('dashboard');
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<'ALL' | StateCode>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const ranked = useMemo(() => PROSPECTS.map((prospect) => ({ ...prospect, score: scoreProspect(prospect) }))
    .sort((a, b) => b.score - a.score), []);
  const filtered = ranked.filter((prospect) => {
    const haystack = `${prospect.company} ${prospect.headquarters} ${prospect.decisionRole}`.toLowerCase();
    return haystack.includes(query.toLowerCase()) && (stateFilter === 'ALL' || prospect.state === stateFilter);
  });
  const selected = ranked.find((prospect) => prospect.id === selectedId) ?? null;
  const totalBuildings = ranked.reduce((sum, prospect) => sum + prospect.portfolioBuildings, 0);
  const totalExposure = ranked.reduce((sum, prospect) => sum + prospect.annualWaterExposure, 0);
  const highPriority = ranked.filter((prospect) => prospect.score >= 75).length;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brandmark" aria-hidden="true"><Droplets size={19} /></div>
        <div className="brandcopy"><strong>PUMA</strong><span>UTILITIES</span></div>
        <div className="live-chip"><i /> NJ · NY · PA</div>
      </header>

      <section className="page-scroll">
        {view === 'dashboard' && (
          <>
            <div className="hero-row">
              <div><p className="eyebrow">Water intelligence command center</p><h1>Find waste before the call.</h1><p className="lede">A prospecting engine first. A managed water portfolio after the close.</p></div>
              <button className="primary-button" onClick={() => setView('prospects')}><Target size={17} />Open leads</button>
            </div>
            <div className="metric-grid">
              <MetricCard icon={Target} label="Seed prospects" value={`${ranked.length}`} note={`${highPriority} currently score high`} />
              <MetricCard icon={Building2} label="Portfolio buildings" value={`${totalBuildings}`} note="Research-seed universe" />
              <MetricCard icon={CircleDollarSign} label="Water exposure" value={formatMoney(totalExposure)} note="Modeled annual exposure" />
              <MetricCard icon={RadioTower} label="Data feeds" value={`${INGESTION_SOURCES.length}`} note="Scaffolded for ingestion" />
            </div>

            <div className="section-head"><div><p className="eyebrow">Priority queue</p><h2>Best current fits</h2></div><button className="text-button" onClick={() => setView('prospects')}>See all <ChevronRight size={15} /></button></div>
            <div className="lead-stack">
              {ranked.slice(0, 3).map((prospect) => (
                <button key={prospect.id} className="lead-row" onClick={() => setSelectedId(prospect.id)}>
                  <div className="lead-avatar">{prospect.company.slice(0, 1)}</div>
                  <div className="lead-main"><strong>{prospect.company}</strong><span>{prospect.state} · {prospect.portfolioBuildings} buildings · {prospect.portfolioUnits.toLocaleString()} units</span></div>
                  <div className="lead-meta"><ScorePill score={prospect.score} /><ChevronRight size={16} /></div>
                </button>
              ))}
            </div>

            <div className="section-head"><div><p className="eyebrow">Pipeline health</p><h2>Engine readiness</h2></div></div>
            <div className="source-grid">
              {INGESTION_SOURCES.map((source) => <article className="source-card" key={source.id}><div className="source-top"><Database size={16} /><span>{source.status}</span></div><strong>{source.name}</strong><p>{source.description}</p><small>{source.geography} · {source.category}</small></article>)}
            </div>
          </>
        )}

        {view === 'prospects' && (
          <>
            <div className="page-title"><div><p className="eyebrow">Prospecting</p><h1>Opportunity queue</h1></div><span>{filtered.length} results</span></div>
            <div className="filters"><label className="searchbox"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, city, role" /></label><div className="state-tabs">{(['ALL','NJ','NY','PA'] as const).map((state) => <button key={state} className={stateFilter === state ? 'active' : ''} onClick={() => setStateFilter(state)}>{state}</button>)}</div></div>
            <div className="prospect-grid">{filtered.map((prospect) => <button key={prospect.id} className="prospect-card" onClick={() => setSelectedId(prospect.id)}><div className="prospect-top"><div><span className="state-chip">{prospect.state}</span><SourceBadge confidence={prospect.confidence} /></div><ScorePill score={prospect.score} /></div><h3>{prospect.company}</h3><p>{prospect.portfolioNote}</p><div className="prospect-stats"><span><Building2 size={14} />{prospect.portfolioBuildings} buildings</span><span><UsersRound size={14} />{prospect.portfolioUnits.toLocaleString()} units</span><span><CircleDollarSign size={14} />{formatMoney(prospect.annualWaterExposure)}</span></div><div className="card-action"><span>{prospect.stage}</span><strong>Inspect <ChevronRight size={14} /></strong></div></button>)}</div>
          </>
        )}

        {view === 'utilities' && (
          <>
            <div className="page-title"><div><p className="eyebrow">Utility intelligence</p><h1>Meter landscape</h1></div><span>{UTILITIES.length} utilities</span></div>
            <div className="utility-grid">{UTILITIES.map((utility) => <article key={utility.id} className="utility-card"><div className="utility-icon"><Gauge size={19} /></div><div className="utility-copy"><div><span className="state-chip">{utility.state}</span><span className="meter-chip">{utility.meterStatus}</span></div><h3>{utility.name}</h3><dl><div><dt>Portal</dt><dd>{utility.portalCapability}</dd></div><div><dt>Public signal</dt><dd>{utility.publicData}</dd></div><div><dt>Rate registry</dt><dd>{utility.rateSource}</dd></div></dl></div></article>)}</div>
          </>
        )}

        {view === 'monitor' && (
          <>
            <div className="page-title"><div><p className="eyebrow">Client mode</p><h1>Portfolio monitor</h1></div><span>Shell ready</span></div>
            <div className="monitor-hero"><div className="pulse-orb"><Activity size={28} /></div><div><strong>Authorized meter feeds will land here.</strong><p>Public prospecting and private client-authorized usage are intentionally separate pipelines. Once a client delegates access, this view becomes the daily operating console.</p></div></div>
            <div className="monitor-grid"><article><span>24h consumption</span><strong>—</strong><small>Awaiting authorized account</small></article><article><span>Leak alerts</span><strong>0</strong><small>No client meters connected</small></article><article><span>Portfolio variance</span><strong>—</strong><small>Peer baseline ready</small></article></div>
            <div className="empty-panel"><Droplets size={24} /><h3>No client account connected yet</h3><p>The monitoring interface is functional and intentionally empty until a customer authorizes data access.</p></div>
          </>
        )}

        {view === 'engine' && (
          <>
            <div className="page-title"><div><p className="eyebrow">Scoring engine</p><h1>What makes a lead hot</h1></div><span>0–100</span></div>
            <div className="engine-card"><div className="engine-intro"><Sparkles size={21} /><div><strong>Opportunity Score v0.1</strong><p>Every lead is scored from observable or explicitly estimated inputs. No private meter data is assumed.</p></div></div><div className="weights">{[['Portfolio scale',20],['Meter opportunity',20],['Public-data coverage',15],['Water-cost exposure',20],['Anomaly signal',15],['Decision-maker reachability',10]].map(([label, value]) => <div key={String(label)}><span>{label}</span><div><i style={{ width: `${Number(value) * 4}%` }} /></div><strong>{value}</strong></div>)}</div></div>
            <div className="source-grid">{INGESTION_SOURCES.map((source) => <article className="source-card" key={source.id}><div className="source-top"><MapPinned size={16} /><span>{source.status}</span></div><strong>{source.name}</strong><p>{source.description}</p><small>{source.geography}</small></article>)}</div>
          </>
        )}
      </section>

      <nav className="bottom-nav" aria-label="Primary navigation">{nav.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon size={20} /><span>{label}</span></button>)}</nav>

      {selected && <div className="drawer-backdrop" onMouseDown={() => setSelectedId(null)}><aside className="detail-drawer" onMouseDown={(event) => event.stopPropagation()}><button className="drawer-close" onClick={() => setSelectedId(null)} aria-label="Close"><X size={18} /></button><div className="detail-hero"><span className="state-chip">{selected.state}</span><SourceBadge confidence={selected.confidence} /><h2>{selected.company}</h2><p>{selected.headquarters}</p><ScorePill score={selected.score} /></div><div className="detail-section"><h3>Why Puma cares</h3><p>{selected.portfolioNote}</p><div className="detail-kpis"><div><span>Buildings</span><strong>{selected.portfolioBuildings}</strong></div><div><span>Units</span><strong>{selected.portfolioUnits.toLocaleString()}</strong></div><div><span>Water exposure</span><strong>{formatMoney(selected.annualWaterExposure)}</strong></div></div></div><ScoreDetails prospect={selected} /><div className="detail-section"><h3>Buyer path</h3><p><strong>{selected.decisionMaker}</strong><br />{selected.decisionRole}</p><p className="next-action">{selected.nextAction}</p></div><div className="detail-section"><h3>Utility footprint</h3><div className="tag-row">{selected.utilityIds.map((id) => <span className="utility-tag" key={id}>{UTILITIES.find((utility) => utility.id === id)?.name ?? id}</span>)}</div></div></aside></div>}
    </main>
  );
}

function ScoreDetails({ prospect }: { prospect: Prospect & { score: number } }) {
  const breakdown = scoreBreakdown(prospect);
  const rows = [
    ['Portfolio', breakdown.portfolio, 20],
    ['Meter opportunity', breakdown.meterOpportunity, 20],
    ['Public data', breakdown.publicData, 15],
    ['Water exposure', breakdown.waterExposure, 20],
    ['Anomaly signal', breakdown.anomaly, 15],
    ['Reachability', breakdown.reachability, 10],
  ] as const;
  return <div className="detail-section"><h3>Score breakdown</h3><div className="score-breakdown">{rows.map(([label, value, max]) => <div key={label}><span>{label}</span><div><i style={{ width: `${(value / max) * 100}%` }} /></div><strong>{value}/{max}</strong></div>)}</div></div>;
}
