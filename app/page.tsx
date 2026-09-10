'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Waves,
  X,
} from 'lucide-react';
import { INGESTION_SOURCES, PROSPECTS, UTILITIES } from '@/lib/data';
import { scoreBand, scoreProspect } from '@/lib/scoring';

type View = 'home' | 'clients' | 'monitor' | 'engine' | 'settings';

type GestureStart = {
  x: number;
  y: number;
  edge: boolean;
};

type UpdateStatus = 'idle' | 'checking' | 'reloading' | 'error';

const PRIMARY_VIEWS: View[] = ['home', 'clients', 'monitor'];

const VIEW_TITLES: Record<View, string> = {
  home: 'Puma',
  clients: 'Clients',
  monitor: 'Monitor',
  engine: 'Engine',
  settings: 'Settings',
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const gesture = useRef<GestureStart | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => undefined);
  }, []);

  const clients = useMemo(
    () => PROSPECTS.map((client) => ({ ...client, score: scoreProspect(client) }))
      .sort((a, b) => a.company.localeCompare(b.company)),
    [],
  );

  const filtered = clients.filter((client) => client.company.toLowerCase().includes(query.toLowerCase()));
  const selected = clients.find((client) => client.id === selectedId) ?? null;
  const selectedUtilities = selected
    ? selected.utilityIds.map((id) => UTILITIES.find((utility) => utility.id === id)).filter(Boolean)
    : [];

  const moveTo = (next: View) => {
    setView(next);
    setMenuOpen(false);
  };

  const updateApp = async () => {
    if (updateStatus === 'checking' || updateStatus === 'reloading') return;
    setUpdateStatus('checking');

    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(async (registration) => {
          await registration.update();
          registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
          registration.active?.postMessage({ type: 'CLEAR_CACHES' });
        }));
      }

      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }

      await fetch(`/?_puma_refresh=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        headers: { 'x-puma-update': '1' },
      });

      setUpdateStatus('reloading');
      window.location.replace(`/?_puma_refresh=${Date.now()}`);
    } catch {
      setUpdateStatus('error');
    }
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

  const updateLabel = updateStatus === 'checking'
    ? 'Checking…'
    : updateStatus === 'reloading'
      ? 'Updating…'
      : updateStatus === 'error'
        ? 'Try again'
        : 'Update App';

  return (
    <main className="app-shell" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <header className="appbar">
        <button className="icon-button" onClick={() => setMenuOpen(true)} aria-label="Menu">
          <Menu size={18} />
        </button>
        <strong className="appbar-title">{VIEW_TITLES[view]}</strong>
        <div className="mark-button" aria-label="Puma Utilities logo">
          <PumaMark />
        </div>
      </header>

      <section key={view} className="screen">
        {view === 'home' && (
          <>
            <div className="home-intro">
              <PumaMark size={42} />
              <div>
                <h1>Puma Utilities</h1>
                <p>Client water intelligence · NJ / NY / PA</p>
              </div>
            </div>

            <SectionLabel>Workspace</SectionLabel>
            <div className="native-group">
              <button className="native-row" onClick={() => setView('clients')}>
                <span className="row-icon"><Building2 size={17} /></span>
                <span className="row-copy"><strong>Clients</strong><small>{clients.length ? `${clients.length} companies` : 'No clients yet'}</small></span>
                <ChevronRight className="chevron" size={16} />
              </button>
              <button className="native-row" onClick={() => setView('monitor')}>
                <span className="row-icon"><Activity size={17} /></span>
                <span className="row-copy"><strong>Monitor</strong><small>Water issues and spend alerts</small></span>
                <ChevronRight className="chevron" size={16} />
              </button>
            </div>

            <SectionLabel>System</SectionLabel>
            <div className="native-group">
              <button className="native-row" onClick={() => setView('engine')}>
                <span className="row-icon"><SlidersHorizontal size={17} /></span>
                <span className="row-copy"><strong>Engine</strong><small>Data and scoring logic</small></span>
                <ChevronRight className="chevron" size={16} />
              </button>
              <button className="native-row" onClick={() => setView('settings')}>
                <span className="row-icon"><Settings size={17} /></span>
                <span className="row-copy"><strong>Settings</strong><small>Integrations and app controls</small></span>
                <ChevronRight className="chevron" size={16} />
              </button>
            </div>
          </>
        )}

        {view === 'clients' && (
          <>
            <div className="screen-heading">
              <h1>Clients</h1>
              <span>{filtered.length} companies</span>
            </div>
            <label className="search-field">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company" />
              {query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}
            </label>

            {filtered.length === 0 ? (
              <EmptyState icon={Building2} title="No clients yet" detail="Client companies will appear here when connected to the engine." />
            ) : (
              <div className="native-group list-group">
                {filtered.map((client) => (
                  <button className="native-row" key={client.id} onClick={() => setSelectedId(client.id)}>
                    <span className="row-copy">
                      <strong>{client.company}</strong>
                      <small>{client.portfolioBuildings} buildings</small>
                    </span>
                    <ChevronRight className="chevron" size={16} />
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {view === 'monitor' && (
          <>
            <div className="screen-heading"><h1>Monitor</h1><span>Client exceptions</span></div>
            <EmptyState
              icon={Activity}
              title="No client alerts"
              detail="Clients with abnormal water use, active leak signals, or spend above configured thresholds will appear here."
            />
          </>
        )}

        {view === 'engine' && (
          <>
            <div className="screen-heading"><h1>Engine</h1><span>Data and scoring logic</span></div>
            <EmptyState icon={SlidersHorizontal} title="No model connected" detail="The shell is ready for the production engine." />
          </>
        )}

        {view === 'settings' && (
          <>
            <div className="screen-heading"><h1>Settings</h1><span>App controls</span></div>

            <SectionLabel>Integrations</SectionLabel>
            <div className="native-group list-group">
              {CONNECTOR_SLOTS.map(({ label, detail, icon: Icon }) => (
                <div className="native-row static-row" key={label}>
                  <span className="row-icon"><Icon size={17} /></span>
                  <span className="row-copy"><strong>{label}</strong><small>{detail}</small></span>
                  <span className="row-status">{INGESTION_SOURCES.length ? 'Available' : 'Not connected'}</span>
                </div>
              ))}
            </div>

            <SectionLabel>App</SectionLabel>
            <div className="native-group list-group">
              <button className="native-row" onClick={updateApp} disabled={updateStatus === 'checking' || updateStatus === 'reloading'}>
                <span className="row-icon"><RefreshCw size={17} /></span>
                <span className="row-copy">
                  <strong>{updateLabel}</strong>
                  <small>Fetch the newest deployed version without reinstalling the PWA</small>
                </span>
                <ChevronRight className="chevron" size={16} />
              </button>
            </div>
            {updateStatus === 'error' && (
              <div className="integration-note"><p>Update failed. Check your connection and tap Update App again.</p></div>
            )}
          </>
        )}
      </section>

      <nav className="bottom-nav compact-nav" aria-label="Primary navigation">
        <button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')} aria-label="Home"><PumaMark size={25} nav /><span>Home</span></button>
        <button className={view === 'clients' ? 'active' : ''} onClick={() => setView('clients')} aria-label="Clients"><Building2 size={18} /><span>Clients</span></button>
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
          <button onClick={() => moveTo('clients')} className={view === 'clients' ? 'current' : ''}><Building2 size={17} /><span>Clients</span><ChevronRight size={15} /></button>
          <button onClick={() => moveTo('monitor')} className={view === 'monitor' ? 'current' : ''}><Activity size={17} /><span>Monitor</span><ChevronRight size={15} /></button>
          <button onClick={() => moveTo('engine')} className={view === 'engine' ? 'current' : ''}><SlidersHorizontal size={17} /><span>Engine</span><ChevronRight size={15} /></button>
          <button onClick={() => moveTo('settings')} className={view === 'settings' ? 'current' : ''}><Settings size={17} /><span>Settings</span><ChevronRight size={15} /></button>
        </div>
      </aside>

      {selected && (
        <div className="detail-backdrop">
          <aside className="prospect-sheet">
            <header className="sheet-appbar">
              <button className="back-button" onClick={() => setSelectedId(null)}><ChevronLeft size={18} />Back</button>
              <strong>Client</strong>
              <span />
            </header>
            <div className="sheet-content">
              <div className="detail-title">
                <h2>{selected.company}</h2>
                <p>{selected.headquarters}</p>
                <Score value={selected.score} />
              </div>

              <SectionLabel>Portfolio</SectionLabel>
              <div className="native-group detail-grid">
                <div><span>Buildings</span><strong>{selected.portfolioBuildings}</strong></div>
                <div><span>Units</span><strong>{selected.portfolioUnits.toLocaleString()}</strong></div>
                <div><span>State</span><strong>{selected.state}</strong></div>
              </div>

              <SectionLabel>Buildings & utilities</SectionLabel>
              {selectedUtilities.length === 0 ? (
                <div className="native-group">
                  <div className="native-row static-row">
                    <span className="row-icon"><Waves size={17} /></span>
                    <span className="row-copy"><strong>No meter records yet</strong><small>Building-level utility, meter type, AMI status, usage and tariff data will appear here.</small></span>
                  </div>
                </div>
              ) : (
                <div className="native-group">
                  {selectedUtilities.map((utility) => utility && (
                    <div className="native-row static-row" key={utility.id}>
                      <span className="row-icon"><Gauge size={17} /></span>
                      <span className="row-copy">
                        <strong>{utility.name}</strong>
                        <small>{utility.meterStatus} · {utility.portalCapability}</small>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
