'use client';

import { useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Database,
  Gauge,
  Globe2,
  House,
  Mail,
  MapPinned,
  Menu,
  PlugZap,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  UsersRound,
  Waves,
  X,
} from 'lucide-react';
import { INGESTION_SOURCES, PROSPECTS, UTILITIES } from '@/lib/data';
import { scoreBand, scoreBreakdown, scoreProspect } from '@/lib/scoring';
import type { Prospect, StateCode } from '@/lib/types';

type View = 'home' | 'prospects' | 'utilities' | 'monitor' | 'engine' | 'integrations';

type GestureStart = {
  x: number;
  y: number;
  edge: boolean;
};

const PRIMARY_VIEWS: View[] = ['home', 'prospects', 'utilities', 'monitor'];

const NAV: { id: View; label: string; icon: LucideIcon }[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'prospects', label: 'Prospects', icon: Target },
  { id: 'utilities', label: 'Utilities', icon: Waves },
  { id: 'monitor', label: 'Monitor', icon: Activity },
];

const VIEW_TITLES: Record<View, string> = {
  home: 'Puma',
  prospects: 'Prospects',
  utilities: 'Utilities',
  monitor: 'Monitor',
  engine: 'Engine',
  integrations: 'Integrations',
};

const INTEGRATIONS: Array<{
  group: string;
  items: Array<{ name: string; detail: string; status: string; icon: LucideIcon }>;
}> = [
  {
    group: 'Property & ownership',
    items: [
      { name: 'Property intelligence', detail: 'Portfolio, ownership, units and parcel context', status: 'Slot ready', icon: Building2 },
      { name: 'Public records', detail: 'Municipal, assessor, deed and registration sources', status: 'Slot ready', icon: MapPinned },
    ],
  },
  {
    group: 'Utility & meter',
    items: [
      { name: 'Utility resolver', detail: 'Service territory, meter capability and tariff sources', status: 'Scaffolded', icon: Gauge },
      { name: 'Authorized meter feeds', detail: 'Customer-approved interval usage and billing access', status: 'Awaiting client', icon: Waves },
    ],
  },
  {
    group: 'Research & enrichment',
    items: [
      { name: 'Public web research', detail: 'Company portfolio, people and operating footprint', status: 'Slot ready', icon: Globe2 },
      { name: 'Company enrichment', detail: 'Decision-maker and organization intelligence', status: 'Slot ready', icon: UsersRound },
    ],
  },
  {
    group: 'Outreach & operations',
    items: [
      { name: 'Email outreach', detail: 'Future prospect follow-up and client communication', status: 'Slot ready', icon: Mail },
      { name: 'Calendar', detail: 'Future meetings, follow-ups and account reviews', status: 'Slot ready', icon: CalendarDays },
    ],
  },
];

const formatMoney = (value: number) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
}).format(value);

function PumaMark({ size = 34 }: { size?: number }) {
  return (
    <span className="puma-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 36 36" fill="none">
        <path d="M18 4.4c-4.6 6-8.2 10.1-8.2 15.3A8.2 8.2 0 0 0 18 28a8.2 8.2 0 0 0 8.2-8.3C26.2 14.5 22.6 10.4 18 4.4Z" />
        <path d="M12.8 21.3c1.7-1.3 3.4-1.3 5.2 0s3.5 1.3 5.2 0" />
        <path d="M14 25c1.3-.8 2.7-.8 4 0 1.3.8 2.7.8 4 0" />
      </svg>
    </span>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const band = scoreBand(score);
  return (
    <span className={`score-badge ${band.toLowerCase()}`}>
      <strong>{score}</strong>
      <small>{band}</small>
    </span>
  );
}

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="section-label">
      <span>{children}</span>
      {action}
    </div>
  );
}

function SourceBadge({ confidence }: { confidence: Prospect['confidence'] }) {
  return <span className="source-badge"><ShieldCheck size={11} />{confidence}</span>;
}

export default function Home() {
  const [view, setView] = useState<View>('home');
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<'ALL' | StateCode>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const gesture = useRef<GestureStart | null>(null);
  const detailGesture = useRef<{ x: number; y: number } | null>(null);

  const ranked = useMemo(
    () => PROSPECTS.map((prospect) => ({ ...prospect, score: scoreProspect(prospect) }))
      .sort((a, b) => b.score - a.score),
    [],
  );

  const filtered = ranked.filter((prospect) => {
    const haystack = `${prospect.company} ${prospect.headquarters} ${prospect.decisionRole}`.toLowerCase();
    return haystack.includes(query.toLowerCase()) && (stateFilter === 'ALL' || prospect.state === stateFilter);
  });

  const selected = ranked.find((prospect) => prospect.id === selectedId) ?? null;
  const totalBuildings = ranked.reduce((sum, prospect) => sum + prospect.portfolioBuildings, 0);
  const totalExposure = ranked.reduce((sum, prospect) => sum + prospect.annualWaterExposure, 0);
  const highPriority = ranked.filter((prospect) => prospect.score >= 75).length;

  const moveTo = (next: View) => {
    setView(next);
    setMenuOpen(false);
  };

  const onTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    if (!touch || selected) return;
    gesture.current = { x: touch.clientX, y: touch.clientY, edge: touch.clientX <= 24 };
  };

  const onTouchEnd = (event: React.TouchEvent<HTMLElement>) => {
    const start = gesture.current;
    gesture.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch || selected) return;

    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 62 || Math.abs(dx) < Math.abs(dy) * 1.35) return;

    if (start.edge && dx > 70) {
      setMenuOpen(true);
      return;
    }

    const index = PRIMARY_VIEWS.indexOf(view);
    if (index === -1) return;
    const nextIndex = dx < 0 ? index + 1 : index - 1;
    if (nextIndex >= 0 && nextIndex < PRIMARY_VIEWS.length) setView(PRIMARY_VIEWS[nextIndex]);
  };

  const closeDetailFromSwipe = (event: React.TouchEvent<HTMLElement>) => {
    const start = detailGesture.current;
    detailGesture.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (dx > 70 && Math.abs(dx) > Math.abs(dy) * 1.25) setSelectedId(null);
  };

  return (
    <main className="app-shell" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <header className="appbar">
        <button className="mark-button" onClick={() => setMenuOpen(true)} aria-label="Open menu">
          <PumaMark size={34} />
        </button>
        <div className="appbar-title">
          <strong>{VIEW_TITLES[view]}</strong>
          <span>Water Intelligence</span>
        </div>
        <button className="icon-button" onClick={() => setMenuOpen(true)} aria-label="More">
          <Menu size={19} />
        </button>
      </header>

      <section key={view} className="screen">
        {view === 'home' && (
          <>
            <div className="home-hero">
              <p className="kicker">NJ · NY · PA</p>
              <h1>Find waste before the call.</h1>
              <p>Prospecting intelligence now. Managed water operations after the close.</p>
            </div>

            <div className="stat-strip" aria-label="Portfolio summary">
              <div><strong>{ranked.length}</strong><span>Prospects</span></div>
              <div><strong>{highPriority}</strong><span>High priority</span></div>
              <div><strong>{totalBuildings}</strong><span>Buildings</span></div>
              <div><strong>{formatMoney(totalExposure)}</strong><span>Modeled exposure</span></div>
            </div>

            <SectionLabel action={<button className="section-action" onClick={() => setView('prospects')}>See all</button>}>Priority</SectionLabel>
            <div className="native-group">
              {ranked.slice(0, 4).map((prospect) => (
                <button className="native-row prospect-row" key={prospect.id} onClick={() => setSelectedId(prospect.id)}>
                  <span className="row-avatar">{prospect.company.slice(0, 1)}</span>
                  <span className="row-copy">
                    <strong>{prospect.company}</strong>
                    <small>{prospect.state} · {prospect.portfolioBuildings} buildings · {prospect.portfolioUnits.toLocaleString()} units</small>
                  </span>
                  <ScoreBadge score={prospect.score} />
                  <ChevronRight className="chevron" size={17} />
                </button>
              ))}
            </div>

            <SectionLabel>Data boundary</SectionLabel>
            <div className="native-group provenance-group">
              <div className="native-row static-row"><span className="dot public" /><span className="row-copy"><strong>Public</strong><small>Ownership, property, utility and benchmarking records</small></span></div>
              <div className="native-row static-row"><span className="dot modeled" /><span className="row-copy"><strong>Modeled</strong><small>Estimates and scoring inputs clearly labeled as estimates</small></span></div>
              <div className="native-row static-row"><span className="dot authorized" /><span className="row-copy"><strong>Client-authorized</strong><small>Private meter and billing data only after permission</small></span></div>
            </div>

            <SectionLabel action={<button className="section-action" onClick={() => setView('integrations')}>Manage</button>}>Engine feeds</SectionLabel>
            <div className="native-group">
              {INGESTION_SOURCES.slice(0, 4).map((source) => (
                <div className="native-row static-row" key={source.id}>
                  <span className="row-icon"><Database size={17} /></span>
                  <span className="row-copy"><strong>{source.name}</strong><small>{source.geography} · {source.category}</small></span>
                  <span className="row-status">{source.status}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {view === 'prospects' && (
          <>
            <div className="screen-heading">
              <p className="kicker">Prospecting</p>
              <h1>Opportunity queue</h1>
              <span>{filtered.length} current results</span>
            </div>

            <label className="search-field">
              <Search size={17} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, city or role" />
              {query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={15} /></button>}
            </label>

            <div className="segmented-control" role="group" aria-label="State filter">
              {(['ALL', 'NJ', 'NY', 'PA'] as const).map((state) => (
                <button key={state} className={stateFilter === state ? 'active' : ''} onClick={() => setStateFilter(state)}>{state}</button>
              ))}
            </div>

            <SectionLabel>Ranked by opportunity</SectionLabel>
            <div className="native-group">
              {filtered.map((prospect) => (
                <button className="native-row prospect-row tall" key={prospect.id} onClick={() => setSelectedId(prospect.id)}>
                  <span className="row-copy">
                    <span className="row-meta"><span>{prospect.state}</span><SourceBadge confidence={prospect.confidence} /></span>
                    <strong>{prospect.company}</strong>
                    <small>{prospect.portfolioBuildings} buildings · {prospect.portfolioUnits.toLocaleString()} units · {formatMoney(prospect.annualWaterExposure)} modeled</small>
                  </span>
                  <ScoreBadge score={prospect.score} />
                  <ChevronRight className="chevron" size={17} />
                </button>
              ))}
            </div>
          </>
        )}

        {view === 'utilities' && (
          <>
            <div className="screen-heading">
              <p className="kicker">Utility intelligence</p>
              <h1>Meter landscape</h1>
              <span>Service territory, portals, meters and rates</span>
            </div>
            <SectionLabel>{UTILITIES.length} utility records</SectionLabel>
            <div className="native-group">
              {UTILITIES.map((utility) => (
                <div className="utility-row" key={utility.id}>
                  <div className="utility-head">
                    <span className="row-icon"><Gauge size={18} /></span>
                    <span className="row-copy"><strong>{utility.name}</strong><small>{utility.state} · {utility.meterStatus}</small></span>
                  </div>
                  <dl className="utility-facts">
                    <div><dt>Portal</dt><dd>{utility.portalCapability}</dd></div>
                    <div><dt>Public signal</dt><dd>{utility.publicData}</dd></div>
                    <div><dt>Rates</dt><dd>{utility.rateSource}</dd></div>
                  </dl>
                </div>
              ))}
            </div>
          </>
        )}

        {view === 'monitor' && (
          <>
            <div className="screen-heading">
              <p className="kicker">Client mode</p>
              <h1>Portfolio monitor</h1>
              <span>Reserved for customer-authorized meter data</span>
            </div>

            <div className="monitor-empty">
              <span className="monitor-mark"><PumaMark size={58} /></span>
              <h2>No client meters connected</h2>
              <p>This surface stays intentionally quiet until a customer delegates access. Public prospecting data never masquerades as private meter data.</p>
            </div>

            <SectionLabel>Live account metrics</SectionLabel>
            <div className="native-group metric-list">
              <div className="native-row static-row"><span className="row-copy"><strong>24h consumption</strong><small>Awaiting authorized interval feed</small></span><span className="metric-value">—</span></div>
              <div className="native-row static-row"><span className="row-copy"><strong>Leak alerts</strong><small>No customer meters connected</small></span><span className="metric-value">0</span></div>
              <div className="native-row static-row"><span className="row-copy"><strong>Portfolio variance</strong><small>Peer baseline is ready</small></span><span className="metric-value">—</span></div>
            </div>
          </>
        )}

        {view === 'engine' && (
          <>
            <div className="screen-heading">
              <p className="kicker">Scoring</p>
              <h1>Opportunity engine</h1>
              <span>Observable and explicitly modeled inputs only</span>
            </div>
            <SectionLabel>Score weights</SectionLabel>
            <div className="native-group weight-list">
              {[
                ['Portfolio scale', 20],
                ['Meter opportunity', 20],
                ['Public-data coverage', 15],
                ['Water-cost exposure', 20],
                ['Anomaly signal', 15],
                ['Decision-maker reachability', 10],
              ].map(([label, weight]) => (
                <div className="weight-row" key={String(label)}>
                  <div><strong>{label}</strong><span>{weight} pts</span></div>
                  <div className="meter"><i style={{ width: `${Number(weight) * 5}%` }} /></div>
                </div>
              ))}
            </div>

            <SectionLabel>Source pipeline</SectionLabel>
            <div className="native-group">
              {INGESTION_SOURCES.map((source) => (
                <div className="native-row static-row" key={source.id}>
                  <span className="row-icon"><Database size={17} /></span>
                  <span className="row-copy"><strong>{source.name}</strong><small>{source.description}</small></span>
                  <span className="row-status">{source.status}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {view === 'integrations' && (
          <>
            <div className="screen-heading">
              <p className="kicker">Connectors</p>
              <h1>Integrations</h1>
              <span>Clean attachment points for the engine you build next</span>
            </div>
            {INTEGRATIONS.map((group) => (
              <div key={group.group}>
                <SectionLabel>{group.group}</SectionLabel>
                <div className="native-group">
                  {group.items.map(({ name, detail, status, icon: Icon }) => (
                    <div className="native-row static-row integration-row" key={name}>
                      <span className="row-icon"><Icon size={18} /></span>
                      <span className="row-copy"><strong>{name}</strong><small>{detail}</small></span>
                      <span className="row-status">{status}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="integration-note"><PlugZap size={17} /><p>These are interface slots, not claims of live access. Each connector can be wired later without redesigning the shell.</p></div>
          </>
        )}
      </section>

      {PRIMARY_VIEWS.includes(view) && (
        <nav className="bottom-nav" aria-label="Primary navigation">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)} aria-label={label}>
              <Icon size={20} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}

      <div className="edge-hint" aria-hidden="true" />

      <div className={`menu-scrim ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)} />
      <aside className={`side-menu ${menuOpen ? 'open' : ''}`} aria-hidden={!menuOpen}>
        <div className="menu-head">
          <div className="menu-brand"><PumaMark size={44} /><div><strong>Puma</strong><span>Water Intelligence</span></div></div>
          <button className="icon-button" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        <div className="menu-nav">
          <button onClick={() => moveTo('home')} className={view === 'home' ? 'current' : ''}><House size={19} /><span>Home</span><ChevronRight size={16} /></button>
          <button onClick={() => moveTo('engine')} className={view === 'engine' ? 'current' : ''}><SlidersHorizontal size={19} /><span>Opportunity engine</span><ChevronRight size={16} /></button>
          <button onClick={() => moveTo('integrations')} className={view === 'integrations' ? 'current' : ''}><PlugZap size={19} /><span>Integrations</span><ChevronRight size={16} /></button>
        </div>
        <div className="menu-foot">
          <span>Markets</span><strong>New Jersey · New York · Pennsylvania</strong>
          <small>Swipe from the left edge to open. Swipe between main tabs to navigate.</small>
        </div>
      </aside>

      {selected && (
        <div className="detail-backdrop" onMouseDown={() => setSelectedId(null)}>
          <aside
            className="prospect-sheet"
            onMouseDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => {
              event.stopPropagation();
              const touch = event.touches[0];
              if (touch) detailGesture.current = { x: touch.clientX, y: touch.clientY };
            }}
            onTouchEnd={(event) => {
              event.stopPropagation();
              closeDetailFromSwipe(event);
            }}
          >
            <header className="sheet-appbar">
              <button className="back-button" onClick={() => setSelectedId(null)}><ChevronLeft size={22} />Back</button>
              <span>Prospect</span>
              <span className="sheet-spacer" />
            </header>
            <div className="sheet-content">
              <div className="detail-title">
                <div className="row-meta"><span>{selected.state}</span><SourceBadge confidence={selected.confidence} /></div>
                <h2>{selected.company}</h2>
                <p>{selected.headquarters}</p>
                <ScoreBadge score={selected.score} />
              </div>

              <SectionLabel>Portfolio</SectionLabel>
              <div className="native-group detail-metrics">
                <div><span>Buildings</span><strong>{selected.portfolioBuildings}</strong></div>
                <div><span>Units</span><strong>{selected.portfolioUnits.toLocaleString()}</strong></div>
                <div><span>Modeled water</span><strong>{formatMoney(selected.annualWaterExposure)}</strong></div>
              </div>

              <SectionLabel>Why it matters</SectionLabel>
              <div className="native-group prose-group"><p>{selected.portfolioNote}</p></div>

              <ScoreDetails prospect={selected} />

              <SectionLabel>Buyer path</SectionLabel>
              <div className="native-group">
                <div className="native-row static-row"><span className="row-copy"><strong>{selected.decisionMaker}</strong><small>{selected.decisionRole}</small></span></div>
                <div className="native-row static-row"><span className="row-copy"><strong>Next action</strong><small>{selected.nextAction}</small></span></div>
              </div>

              <SectionLabel>Utility footprint</SectionLabel>
              <div className="native-group">
                {selected.utilityIds.map((id) => (
                  <div className="native-row static-row" key={id}>
                    <span className="row-icon"><Waves size={17} /></span>
                    <span className="row-copy"><strong>{UTILITIES.find((utility) => utility.id === id)?.name ?? id}</strong><small>Utility record</small></span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}
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

  return (
    <>
      <SectionLabel>Score breakdown</SectionLabel>
      <div className="native-group weight-list">
        {rows.map(([label, value, max]) => (
          <div className="weight-row" key={label}>
            <div><strong>{label}</strong><span>{value}/{max}</span></div>
            <div className="meter"><i style={{ width: `${(value / max) * 100}%` }} /></div>
          </div>
        ))}
      </div>
    </>
  );
}
