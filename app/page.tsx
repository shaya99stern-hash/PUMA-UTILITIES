'use client';

import { useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Building2,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Globe2,
  Mail,
  Menu,
  PlugZap,
  Search,
  SlidersHorizontal,
  Target,
  Waves,
  X,
} from 'lucide-react';
import { INGESTION_SOURCES, PROSPECTS, UTILITIES } from '@/lib/data';
import { scoreBand, scoreProspect } from '@/lib/scoring';
import type { StateCode } from '@/lib/types';

type View = 'home' | 'prospects' | 'utilities' | 'monitor' | 'engine' | 'integrations';

type GestureStart = {
  x: number;
  y: number;
  edge: boolean;
};

const PRIMARY_VIEWS: View[] = ['home', 'prospects', 'utilities', 'monitor'];

const VIEW_TITLES: Record<View, string> = {
  home: 'Puma',
  prospects: 'Prospects',
  utilities: 'Utilities',
  monitor: 'Monitor',
  engine: 'Engine',
  integrations: 'Integrations',
};

const CONNECTOR_SLOTS: Array<{ label: string; detail: string; icon: LucideIcon }> = [
  { label: 'Property data', detail: 'Ownership, portfolio and parcel sources', icon: Building2 },
  { label: 'Utility data', detail: 'Meter, service territory and tariff sources', icon: Gauge },
  { label: 'Enrichment', detail: 'Company and decision-maker research', icon: Globe2 },
  { label: 'Outreach', detail: 'Email and operating workflows', icon: Mail },
];

function PumaMark({ size = 30, nav = false }: { size?: number; nav?: boolean }) {
  return (
    <span className={`puma-mark${nav ? ' nav-mark' : ''}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 36 36" fill="none">
        <circle cx="18" cy="18" r="10.6" />
        <path d="M11.6 20.5a6.8 6.8 0 0 1 12.8 0" />
        <path d="M18 18l4.5-4.2" />
        <circle cx="18" cy="18" r="1.45" />
        <path d="M18 7.4c-1.5 2.2-2.6 3.7-2.6 5.1a2.6 2.6 0 0 0 5.2 0c0-1.4-1.1-2.9-2.6-5.1Z" />
      </svg>
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="section-label">{children}</div>;
}

function EmptyState({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon size={18} /></span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function Score({ value }: { value: number }) {
  const band = scoreBand(value).toLowerCase();
  return <span className={`score ${band}`}>{value}</span>;
}

export default function Home() {
  const [view, setView] = useState<View>('home');
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<'ALL' | StateCode>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const gesture = useRef<GestureStart | null>(null);

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
    if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.35) return;

    if (start.edge && dx > 72) {
      setMenuOpen(true);
      return;
    }

    const index = PRIMARY_VIEWS.indexOf(view);
    if (index === -1) return;
    const nextIndex = dx < 0 ? index + 1 : index - 1;
    if (nextIndex >= 0 && nextIndex < PRIMARY_VIEWS.length) setView(PRIMARY_VIEWS[nextIndex]);
  };

  return (
    <main className="app-shell" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <header className="appbar">
        <button className="mark-button" onClick={() => setMenuOpen(true)} aria-label="Open menu">
          <PumaMark />
        </button>
        <strong className="appbar-title">{VIEW_TITLES[view]}</strong>
        <button className="icon-button" onClick={() => setMenuOpen(true)} aria-label="Menu">
          <Menu size={18} />
        </button>
      </header>

      <section key={view} className="screen">
        {view === 'home' && (
          <>
            <div className="home-intro">
              <PumaMark size={42} />
              <div>
                <h1>Puma Utilities</h1>
                <p>Water intelligence · NJ / NY / PA</p>
              </div>
            </div>

            <SectionLabel>Workspace</SectionLabel>
            <div className="native-group">
              <button className="native-row" onClick={() => setView('prospects')}>
                <span className="row-icon"><Target size={17} /></span>
                <span className="row-copy"><strong>Prospects</strong><small>{ranked.length ? `${ranked.length} records` : 'No data yet'}</small></span>
                <ChevronRight className="chevron" size={16} />
              </button>
              <button className="native-row" onClick={() => setView('utilities')}>
                <span className="row-icon"><Waves size={17} /></span>
                <span className="row-copy"><strong>Utilities</strong><small>{UTILITIES.length ? `${UTILITIES.length} records` : 'No data yet'}</small></span>
                <ChevronRight className="chevron" size={16} />
              </button>
              <button className="native-row" onClick={() => setView('monitor')}>
                <span className="row-icon"><Activity size={17} /></span>
                <span className="row-copy"><strong>Monitor</strong><small>No accounts connected</small></span>
                <ChevronRight className="chevron" size={16} />
              </button>
            </div>

            <SectionLabel>System</SectionLabel>
            <div className="native-group">
              <button className="native-row" onClick={() => setView('engine')}>
                <span className="row-icon"><SlidersHorizontal size={17} /></span>
                <span className="row-copy"><strong>Engine</strong><small>Not configured</small></span>
                <ChevronRight className="chevron" size={16} />
              </button>
              <button className="native-row" onClick={() => setView('integrations')}>
                <span className="row-icon"><PlugZap size={17} /></span>
                <span className="row-copy"><strong>Integrations</strong><small>{INGESTION_SOURCES.length ? `${INGESTION_SOURCES.length} connected` : 'Not connected'}</small></span>
                <ChevronRight className="chevron" size={16} />
              </button>
            </div>
          </>
        )}

        {view === 'prospects' && (
          <>
            <div className="screen-heading">
              <h1>Prospects</h1>
              <span>{filtered.length} records</span>
            </div>
            <label className="search-field">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" />
              {query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}
            </label>
            <div className="segmented-control" role="group" aria-label="State filter">
              {(['ALL', 'NJ', 'NY', 'PA'] as const).map((state) => (
                <button key={state} className={stateFilter === state ? 'active' : ''} onClick={() => setStateFilter(state)}>{state}</button>
              ))}
            </div>
            {filtered.length === 0 ? (
              <EmptyState icon={Target} title="No prospects yet" detail="Real engine results will appear here." />
            ) : (
              <div className="native-group list-group">
                {filtered.map((prospect) => (
                  <button className="native-row" key={prospect.id} onClick={() => setSelectedId(prospect.id)}>
                    <span className="row-copy"><strong>{prospect.company}</strong><small>{prospect.state} · {prospect.headquarters}</small></span>
                    <Score value={prospect.score} />
                    <ChevronRight className="chevron" size={16} />
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {view === 'utilities' && (
          <>
            <div className="screen-heading">
              <h1>Utilities</h1>
              <span>{UTILITIES.length} records</span>
            </div>
            {UTILITIES.length === 0 ? (
              <EmptyState icon={Waves} title="No utility data yet" detail="Utility records will appear when the engine connects them." />
            ) : (
              <div className="native-group list-group">
                {UTILITIES.map((utility) => (
                  <div className="native-row static-row" key={utility.id}>
                    <span className="row-icon"><Gauge size={17} /></span>
                    <span className="row-copy"><strong>{utility.name}</strong><small>{utility.state} · {utility.meterStatus}</small></span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {view === 'monitor' && (
          <>
            <div className="screen-heading"><h1>Monitor</h1><span>Client data</span></div>
            <EmptyState icon={Activity} title="No meter accounts" detail="Authorized customer usage will appear here." />
          </>
        )}

        {view === 'engine' && (
          <>
            <div className="screen-heading"><h1>Engine</h1><span>Prospecting logic</span></div>
            <EmptyState icon={SlidersHorizontal} title="No model connected" detail="The shell is ready for the production scoring engine." />
          </>
        )}

        {view === 'integrations' && (
          <>
            <div className="screen-heading"><h1>Integrations</h1><span>Connection points</span></div>
            <div className="native-group list-group">
              {CONNECTOR_SLOTS.map(({ label, detail, icon: Icon }) => (
                <div className="native-row static-row" key={label}>
                  <span className="row-icon"><Icon size={17} /></span>
                  <span className="row-copy"><strong>{label}</strong><small>{detail}</small></span>
                  <span className="row-status">Not connected</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <nav className="bottom-nav" aria-label="Primary navigation">
        <button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')} aria-label="Home"><PumaMark size={25} nav /><span>Home</span></button>
        <button className={view === 'prospects' ? 'active' : ''} onClick={() => setView('prospects')} aria-label="Prospects"><Target size={18} /><span>Prospects</span></button>
        <button className={view === 'utilities' ? 'active' : ''} onClick={() => setView('utilities')} aria-label="Utilities"><Waves size={18} /><span>Utilities</span></button>
        <button className={view === 'monitor' ? 'active' : ''} onClick={() => setView('monitor')} aria-label="Monitor"><Activity size={18} /><span>Monitor</span></button>
      </nav>

      <div className={`menu-scrim ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)} />
      <aside className={`side-menu ${menuOpen ? 'open' : ''}`} aria-hidden={!menuOpen}>
        <div className="menu-head">
          <div className="menu-brand"><PumaMark size={36} /><div><strong>Puma</strong><span>Utilities</span></div></div>
          <button className="icon-button" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={17} /></button>
        </div>
        <div className="menu-nav">
          <button onClick={() => moveTo('home')} className={view === 'home' ? 'current' : ''}><PumaMark size={22} nav /><span>Home</span><ChevronRight size={15} /></button>
          <button onClick={() => moveTo('prospects')} className={view === 'prospects' ? 'current' : ''}><Target size={17} /><span>Prospects</span><ChevronRight size={15} /></button>
          <button onClick={() => moveTo('utilities')} className={view === 'utilities' ? 'current' : ''}><Waves size={17} /><span>Utilities</span><ChevronRight size={15} /></button>
          <button onClick={() => moveTo('monitor')} className={view === 'monitor' ? 'current' : ''}><Activity size={17} /><span>Monitor</span><ChevronRight size={15} /></button>
          <button onClick={() => moveTo('engine')} className={view === 'engine' ? 'current' : ''}><SlidersHorizontal size={17} /><span>Engine</span><ChevronRight size={15} /></button>
          <button onClick={() => moveTo('integrations')} className={view === 'integrations' ? 'current' : ''}><PlugZap size={17} /><span>Integrations</span><ChevronRight size={15} /></button>
        </div>
      </aside>

      {selected && (
        <div className="detail-backdrop">
          <aside className="prospect-sheet">
            <header className="sheet-appbar">
              <button className="back-button" onClick={() => setSelectedId(null)}><ChevronLeft size={18} />Back</button>
              <strong>Prospect</strong>
              <span />
            </header>
            <div className="sheet-content">
              <div className="detail-title"><h2>{selected.company}</h2><p>{selected.headquarters}</p><Score value={selected.score} /></div>
              <SectionLabel>Portfolio</SectionLabel>
              <div className="native-group detail-grid">
                <div><span>Buildings</span><strong>{selected.portfolioBuildings}</strong></div>
                <div><span>Units</span><strong>{selected.portfolioUnits.toLocaleString()}</strong></div>
                <div><span>State</span><strong>{selected.state}</strong></div>
              </div>
              <SectionLabel>Buyer</SectionLabel>
              <div className="native-group prose-group"><strong>{selected.decisionMaker}</strong><p>{selected.decisionRole}</p></div>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
