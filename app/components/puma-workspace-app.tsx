'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Building2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  FileSearch,
  Gauge,
  Globe2,
  Menu,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Waves,
  X,
} from 'lucide-react';
import { buildMonitorAlerts } from '@/lib/monitor';
import { scoreBand, scoreCompany } from '@/lib/scoring';
import { mergeReleaseOneSeeds, WORKSPACE_RELEASE } from '@/lib/seed';
import { SOURCE_CATALOG } from '@/lib/sources';
import type {
  Company,
  OpportunityScore,
  PipelineStage,
  Property,
  Provenance,
  UtilityService,
  Workspace,
} from '@/lib/types';
import { loadWorkspace, saveWorkspace } from '@/lib/workspace';

export type PumaView = 'home' | 'clients' | 'monitor' | 'engine' | 'settings';

type PumaWorkspaceAppProps = {
  view: PumaView;
  companyId?: string;
};

type GestureStart = {
  x: number;
  y: number;
  edge: boolean;
};

type UpdateStatus = 'idle' | 'checking' | 'reloading' | 'error';
type StageFilter = 'All' | PipelineStage;

const PRIMARY_VIEWS: PumaView[] = ['home', 'clients', 'monitor'];

const VIEW_TITLES: Record<PumaView, string> = {
  home: 'Puma',
  clients: 'Clients',
  monitor: 'Monitor',
  engine: 'Engine',
  settings: 'Settings',
};

const STAGES: StageFilter[] = ['All', 'Research', 'Qualified', 'Outreach', 'Client'];

const CONNECTOR_STATUS: Array<{ label: string; detail: string; status: string; icon: LucideIcon }> = [
  {
    label: 'Official source references',
    detail: 'Public catalog links only — not live connectors or automatic ingestion.',
    status: 'Registry only',
    icon: Globe2,
  },
  {
    label: 'Client usage import',
    detail: 'No upload, API, or account connection is authorized in this release.',
    status: 'Not connected',
    icon: Waves,
  },
  {
    label: 'Property & utility research',
    detail: 'Address and service-area matching require per-property review.',
    status: 'Manual review',
    icon: Building2,
  },
  {
    label: 'Portal access',
    detail: 'Puma stores no portal credentials and does not automate utility portals.',
    status: 'Unavailable',
    icon: ShieldCheck,
  },
];

function routeFor(view: PumaView) {
  if (view === 'home') return '/';
  return `/${view}`;
}

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

function EvidencePill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'positive' | 'warning' }) {
  return <span className={`evidence-pill ${tone}`}>{children}</span>;
}

function Score({ score }: { score: OpportunityScore }) {
  if (score.total === undefined) {
    return <span className="unscored-pill">Unscored</span>;
  }
  return <span className={`score ${scoreBand(score.total).toLowerCase()}`}>{score.total}</span>;
}

function readableDate(value?: string) {
  if (!value) return 'Not logged';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not logged';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function publicSources(company: Company, properties: Property[]) {
  const byId = new Map<string, Provenance>();
  [...company.provenance, ...properties.flatMap((property) => property.provenance)].forEach((source) => {
    byId.set(source.id, source);
  });
  return [...byId.values()];
}

function formatPortfolio(company: Company) {
  if (!company.portfolio || company.portfolio.length === 0) return 'Portfolio fact not sourced';
  return company.portfolio.map((metric) => metric.statement ?? `${metric.value.toLocaleString()}${metric.qualifier === 'at-least' ? '+' : ''} ${metric.label}`).join(' · ');
}

function factorCount(score: OpportunityScore) {
  return score.factors.filter((factor) => factor.state === 'evidenced').length;
}

function companyUtilities(company: Company, workspace: Workspace) {
  const propertyIds = new Set(workspace.properties.filter((property) => property.companyId === company.id).map((property) => property.id));
  return workspace.utilities.filter((utility) => propertyIds.has(utility.propertyId));
}

function utilityLabel(utility: UtilityService) {
  const capability = utility.capability === 'unknown' ? 'meter capability unknown' : utility.capability.replace('-', ' ');
  const portal = utility.portal === 'unknown' ? 'portal status unknown' : utility.portal.replace('-', ' ');
  return `${capability} · ${portal}`;
}

function CompanySource({ source }: { source: Provenance }) {
  return (
    <div className="source-row">
      <div className="source-row-copy">
        <strong>{source.label}</strong>
        <small>{source.note ?? 'Source note not recorded.'}</small>
        <span>Public evidence · retrieved {readableDate(source.retrievedAt)}</span>
      </div>
      {source.reference ? (
        <a className="source-link" href={source.reference} target="_blank" rel="noreferrer">Open source</a>
      ) : <EvidencePill>Reference unavailable</EvidencePill>}
    </div>
  );
}

function CompanyDetail({ company, workspace }: { company: Company; workspace: Workspace }) {
  const companyProperties = workspace.properties.filter((property) => property.companyId === company.id);
  const utilities = companyUtilities(company, workspace);
  const score = scoreCompany(company, workspace);
  const sources = publicSources(company, companyProperties);
  const sourceCount = sources.filter((source) => source.status === 'verified-public').length;

  return (
    <>
      <div className="detail-page-heading">
        <Link href="/clients" className="back-button"><ChevronLeft size={18} />Clients</Link>
        <EvidencePill tone="warning">Research target · not a client</EvidencePill>
      </div>

      <div className="detail-title route-detail-title">
        <div>
          <h1>{company.name}</h1>
          <p>{company.market ?? 'Market not logged'} · {company.stage}</p>
        </div>
        <Score score={score} />
      </div>
      <p className="detail-disclaimer">{company.notes ?? 'Public research only. Unknown fields are not negative findings.'}</p>

      <SectionLabel>Portfolio</SectionLabel>
      <div className="native-group">
        <div className="prose-group">
          <strong>{formatPortfolio(company)}</strong>
          <p>{sourceCount > 0 ? `Public portfolio statement supported by ${sourceCount} logged source${sourceCount === 1 ? '' : 's'}.` : 'No portfolio source is logged.'}</p>
        </div>
      </div>

      <SectionLabel>Property & utility pathway</SectionLabel>
      {companyProperties.length === 0 ? (
        <div className="native-group">
          <div className="native-row static-row">
            <span className="row-icon"><FileSearch size={17} /></span>
            <span className="row-copy"><strong>No property-level record yet</strong><small>There is no verified address, utility service, meter, tariff, bill, or smart-meter status in this workspace.</small></span>
          </div>
        </div>
      ) : (
        <div className="native-group list-group">
          {companyProperties.map((property) => {
            const propertyUtilities = utilities.filter((utility) => utility.propertyId === property.id);
            return (
              <div className="property-row" key={property.id}>
                <strong>{property.name}</strong>
                <small>{property.address.value ?? 'Address unknown'} · {property.state}</small>
                {propertyUtilities.length === 0 ? <span>Utility pathway not yet recorded</span> : propertyUtilities.map((utility) => <span key={utility.id}>{utility.provider} · {utilityLabel(utility)}</span>)}
              </div>
            );
          })}
        </div>
      )}
      {company.researchPathways && company.researchPathways.length > 0 && (
        <div className="research-pathways">
          {company.researchPathways.map((pathway) => <p key={pathway}>{pathway}</p>)}
        </div>
      )}

      <SectionLabel>Evidence</SectionLabel>
      <div className="native-group source-group">
        {sources.length === 0 ? <div className="prose-group"><strong>No public sources logged</strong><p>Do not infer a portfolio, property, utility, or usage fact without a retained source.</p></div> : sources.map((source) => <CompanySource source={source} key={source.id} />)}
      </div>

      <SectionLabel>Research scoring</SectionLabel>
      <div className="native-group score-summary">
        <div className="score-summary-head">
          <div><strong>{score.total === undefined ? 'Score withheld' : `${score.total} opportunity score`}</strong><small>{factorCount(score)} of {score.factors.length} sourcing factors supported</small></div>
          <Score score={score} />
        </div>
        {score.factors.map((factor) => (
          <div className="factor-row" key={factor.id}>
            <span><strong>{factor.label}</strong><small>{factor.detail}</small></span>
            {factor.state === 'evidenced' ? <EvidencePill tone="positive">{factor.points}/{factor.maxPoints}</EvidencePill> : <EvidencePill>Needs evidence</EvidencePill>}
          </div>
        ))}
      </div>

      <SectionLabel>Next action</SectionLabel>
      <div className="native-group">
        <div className="prose-group"><strong>{company.nextAction ?? 'Add a traceable public source before drawing a conclusion.'}</strong><p>Research status does not authorize monitoring. A client must explicitly authorize a bill, export, or approved integration before readings can appear.</p></div>
      </div>
    </>
  );
}

export default function PumaWorkspaceApp({ view, companyId }: PumaWorkspaceAppProps) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<StageFilter>('All');
  const [menuOpen, setMenuOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [exportStatus, setExportStatus] = useState<'idle' | 'done' | 'error'>('idle');
  const gesture = useRef<GestureStart | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuCloseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const loaded = loadWorkspace();
    const hydrated = mergeReleaseOneSeeds(loaded);
    setWorkspace(hydrated);
    if (hydrated !== loaded && !saveWorkspace(hydrated)) setExportStatus('error');
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    menuCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        window.setTimeout(() => menuButtonRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  const companies = useMemo(() => {
    if (!workspace) return [];
    return workspace.companies
      .map((company) => ({ company, score: scoreCompany(company, workspace) }))
      .sort((left, right) => left.company.name.localeCompare(right.company.name));
  }, [workspace]);

  const filteredCompanies = useMemo(() => companies.filter(({ company }) => {
    const lowered = query.toLowerCase().trim();
    const queryMatches = !lowered || company.name.toLowerCase().includes(lowered) || company.market?.toLowerCase().includes(lowered);
    const stageMatches = stageFilter === 'All' || company.stage === stageFilter;
    return queryMatches && stageMatches;
  }), [companies, query, stageFilter]);

  const selectedCompany = companyId && workspace ? workspace.companies.find((company) => company.id === companyId) : undefined;
  const alerts = workspace ? buildMonitorAlerts(workspace) : [];
  const clientCount = workspace?.companies.filter((company) => company.stage === 'Client').length ?? 0;
  const researchCount = workspace?.companies.filter((company) => company.stage === 'Research').length ?? 0;

  const closeMenu = () => {
    setMenuOpen(false);
    window.setTimeout(() => menuButtonRef.current?.focus(), 0);
  };

  const moveTo = (next: PumaView) => {
    closeMenu();
    router.push(routeFor(next));
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
        }));
      }

      await fetch(`${window.location.pathname}?_puma_refresh=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        headers: { 'x-puma-update': '1' },
      });

      setUpdateStatus('reloading');
      window.setTimeout(() => window.location.reload(), 350);
    } catch {
      setUpdateStatus('error');
    }
  };

  const exportWorkspace = () => {
    if (!workspace) return;
    try {
      const blob = new Blob([JSON.stringify(workspace, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `puma-workspace-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setExportStatus('done');
    } catch {
      setExportStatus('error');
    }
  };

  const onTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    if (companyId) return;
    const touch = event.touches[0];
    if (!touch) return;
    gesture.current = { x: touch.clientX, y: touch.clientY, edge: touch.clientX <= 24 };
  };

  const onTouchEnd = (event: React.TouchEvent<HTMLElement>) => {
    const start = gesture.current;
    gesture.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch || companyId) return;
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
    if (nextIndex >= 0 && nextIndex < PRIMARY_VIEWS.length) router.push(routeFor(PRIMARY_VIEWS[nextIndex]));
  };

  const updateLabel = updateStatus === 'checking'
    ? 'Checking…'
    : updateStatus === 'reloading'
      ? 'Updating…'
      : updateStatus === 'error'
        ? 'Try again'
        : 'Update App';

  const pageTitle = companyId ? 'Company' : VIEW_TITLES[view];

  return (
    <main className="app-shell" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <header className="appbar">
        <button ref={menuButtonRef} className="icon-button" onClick={() => setMenuOpen(true)} aria-label="Menu" aria-expanded={menuOpen} aria-controls="puma-navigation">
          <Menu size={18} />
        </button>
        <strong className="appbar-title">{pageTitle}</strong>
        <div className="mark-button" aria-label="Puma Utilities logo"><PumaMark /></div>
      </header>

      <section key={`${view}-${companyId ?? 'index'}`} className="screen">
        {!workspace ? (
          <EmptyState icon={RefreshCw} title="Opening workspace" detail="Loading the local Puma research workspace." />
        ) : view === 'home' ? (
          <>
            <div className="home-intro">
              <PumaMark size={42} />
              <div><h1>Puma Utilities</h1><p>Evidence-aware water research · NJ / NY / PA</p></div>
            </div>

            <SectionLabel>Workspace</SectionLabel>
            <div className="native-group">
              <Link className="native-row" href="/clients">
                <span className="row-icon"><Building2 size={17} /></span>
                <span className="row-copy"><strong>Clients</strong><small>{researchCount} research targets · {clientCount} active clients</small></span>
                <ChevronRight className="chevron" size={16} />
              </Link>
              <Link className="native-row" href="/monitor">
                <span className="row-icon"><Activity size={17} /></span>
                <span className="row-copy"><strong>Monitor</strong><small>{alerts.length ? `${alerts.length} client-authorized alerts` : 'No client-authorized readings'}</small></span>
                <ChevronRight className="chevron" size={16} />
              </Link>
            </div>

            <SectionLabel>System</SectionLabel>
            <div className="native-group">
              <Link className="native-row" href="/engine">
                <span className="row-icon"><SlidersHorizontal size={17} /></span>
                <span className="row-copy"><strong>Engine</strong><small>{SOURCE_CATALOG.length} official source references · registry only</small></span>
                <ChevronRight className="chevron" size={16} />
              </Link>
              <Link className="native-row" href="/settings">
                <span className="row-icon"><Settings size={17} /></span>
                <span className="row-copy"><strong>Settings</strong><small>Local workspace and app controls</small></span>
                <ChevronRight className="chevron" size={16} />
              </Link>
            </div>

            <div className="boundary-note"><ShieldCheck size={15} /><p>Public research can identify what to verify next. It never creates a water alert, bill, or client relationship.</p></div>
          </>
        ) : view === 'clients' && companyId ? (
          selectedCompany ? <CompanyDetail company={selectedCompany} workspace={workspace} /> : <EmptyState icon={CircleHelp} title="Company not found" detail="This local workspace does not contain that company. Return to Clients to choose a research record." />
        ) : view === 'clients' ? (
          <>
            <div className="screen-heading"><h1>Clients</h1><span>{filteredCompanies.length} companies</span></div>
            <p className="screen-note">Company-first research directory. These seeded records are public targets, not clients or confirmed utility accounts.</p>
            <label className="search-field">
              <Search size={16} />
              <input aria-label="Search companies" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company or market" />
              {query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}
            </label>
            <div className="stage-filter" aria-label="Filter by stage">
              {STAGES.map((stage) => <button className={stage === stageFilter ? 'active' : ''} onClick={() => setStageFilter(stage)} key={stage}>{stage}</button>)}
            </div>

            {filteredCompanies.length === 0 ? (
              <EmptyState icon={Building2} title="No matching companies" detail="Search by company name or market, or choose a different research stage." />
            ) : (
              <div className="native-group list-group company-list">
                {filteredCompanies.map(({ company, score }) => (
                  <Link className="native-row company-row" key={company.id} href={`/clients/${company.id}`}>
                    <span className="row-copy">
                      <strong>{company.name}</strong>
                      <small>{company.market ?? 'Market unknown'} · {formatPortfolio(company)}</small>
                      <span className="company-meta"><EvidencePill tone="warning">{company.stage}</EvidencePill><span>{factorCount(score)}/{score.factors.length} factors sourced · {readableDate(company.updatedAt)}</span></span>
                    </span>
                    <Score score={score} />
                    <ChevronRight className="chevron" size={16} />
                  </Link>
                ))}
              </div>
            )}
          </>
        ) : view === 'monitor' ? (
          <>
            <div className="screen-heading"><h1>Monitor</h1><span>Client exceptions</span></div>
            <div className="boundary-note"><ShieldCheck size={15} /><p>Only Client-stage companies with client-authorized readings are evaluated. Public research never produces an alert.</p></div>
            {alerts.length === 0 ? (
              <EmptyState icon={Activity} title="No client alerts" detail="No client-authorized readings exist in this local workspace. Importing public research does not create monitoring data." />
            ) : (
              <div className="native-group list-group">
                {alerts.map((alert) => {
                  const company = workspace.companies.find((item) => item.id === alert.companyId);
                  return <div className="alert-row" key={alert.id}><EvidencePill tone="positive">Authorized</EvidencePill><strong>{alert.title}</strong><small>{company?.name ?? 'Client'} · {alert.kind} · {alert.periodEnd ? readableDate(alert.periodEnd) : 'period not logged'}</small><p>{alert.detail}</p></div>;
                })}
              </div>
            )}
          </>
        ) : view === 'engine' ? (
          <>
            <div className="screen-heading"><h1>Engine</h1><span>Research control plane</span></div>
            <div className="engine-intro"><Globe2 size={17} /><p>These are official public references, not live connectors. Coverage varies by location, source version, and property review.</p></div>
            <SectionLabel>Official source catalog</SectionLabel>
            <div className="native-group source-catalog">
              {SOURCE_CATALOG.map((source) => (
                <div className="catalog-row" key={source.id}>
                  <div><strong>{source.name}</strong><small>{source.markets.join(' / ')} · {source.kind} · {source.access}</small><p>{source.description}</p></div>
                  <a className="source-link" href={source.url} target="_blank" rel="noreferrer">Open</a>
                </div>
              ))}
            </div>
            <SectionLabel>Scoring boundary</SectionLabel>
            <div className="native-group"><div className="prose-group"><strong>Evidence-gated opportunity scoring</strong><p>A score is withheld until portfolio fit, data availability, meter/portal opportunity, excess-use comparison, and decision-maker access are each sourced. Unknown is not zero.</p></div></div>
            <SectionLabel>Monitoring handoff</SectionLabel>
            <div className="native-group"><div className="prose-group"><strong>Research → explicit client authorization</strong><p>Before a client reading is accepted, retain the authorization pathway and the original bill/export or approved source reference. This release does not connect to portals or scrape them.</p></div></div>
          </>
        ) : (
          <>
            <div className="screen-heading"><h1>Settings</h1><span>App controls</span></div>
            <SectionLabel>Integrations</SectionLabel>
            <div className="native-group list-group">
              {CONNECTOR_STATUS.map(({ label, detail, status, icon: Icon }) => (
                <div className="native-row static-row" key={label}>
                  <span className="row-icon"><Icon size={17} /></span>
                  <span className="row-copy"><strong>{label}</strong><small>{detail}</small></span>
                  <span className="row-status">{status}</span>
                </div>
              ))}
            </div>

            <SectionLabel>Local workspace</SectionLabel>
            <div className="native-group list-group">
              <div className="native-row static-row"><span className="row-icon"><ShieldCheck size={17} /></span><span className="row-copy"><strong>Stored on this device</strong><small>{WORKSPACE_RELEASE} · last saved {readableDate(workspace.updatedAt)} · app updates do not clear this workspace.</small></span></div>
              <button className="native-row" onClick={exportWorkspace}>
                <span className="row-icon"><Download size={17} /></span>
                <span className="row-copy"><strong>Export workspace</strong><small>Download a local JSON copy of your research and authorized records.</small></span>
                <ChevronRight className="chevron" size={16} />
              </button>
            </div>
            {exportStatus === 'done' && <div className="integration-note"><p>Workspace export started. Local data remains in the app.</p></div>}
            {exportStatus === 'error' && <div className="integration-note"><p>Local persistence or export was unavailable. The open workspace has not been cleared.</p></div>}

            <SectionLabel>App</SectionLabel>
            <div className="native-group list-group">
              <button className="native-row" onClick={updateApp} disabled={updateStatus === 'checking' || updateStatus === 'reloading'}>
                <span className="row-icon"><RefreshCw size={17} /></span>
                <span className="row-copy"><strong>{updateLabel}</strong><small>Check the deployed app shell. Puma-only stale caches may be retired; local workspace data is never cleared.</small></span>
                <ChevronRight className="chevron" size={16} />
              </button>
            </div>
            {updateStatus === 'error' && <div className="integration-note"><p>Update check failed. Check the connection and tap Update App again.</p></div>}
          </>
        )}
      </section>

      <nav className="bottom-nav compact-nav" aria-label="Primary navigation">
        <Link className={view === 'home' ? 'active' : ''} href="/" aria-label="Home"><PumaMark size={25} nav /><span>Home</span></Link>
        <Link className={view === 'clients' ? 'active' : ''} href="/clients" aria-label="Clients"><Building2 size={18} /><span>Clients</span></Link>
        <Link className={view === 'monitor' ? 'active' : ''} href="/monitor" aria-label="Monitor"><Activity size={18} /><span>Monitor</span></Link>
      </nav>

      <div className={`menu-scrim ${menuOpen ? 'open' : ''}`} onClick={closeMenu} />
      <aside id="puma-navigation" className={`side-menu ${menuOpen ? 'open' : ''}`} aria-hidden={!menuOpen} aria-label="Puma navigation">
        <div className="menu-head">
          <div className="menu-brand"><PumaMark size={36} /><div><strong>Puma</strong><span>Utilities</span></div></div>
          <button ref={menuCloseRef} className="icon-button" onClick={closeMenu} aria-label="Close menu"><X size={17} /></button>
        </div>
        <div className="menu-nav">
          {([
            ['home', PumaMark],
            ['clients', Building2],
            ['monitor', Activity],
            ['engine', SlidersHorizontal],
            ['settings', Settings],
          ] as const).map(([target, Icon]) => (
            <button onClick={() => moveTo(target)} className={view === target ? 'current' : ''} key={target}>
              {target === 'home' ? <PumaMark size={22} nav /> : <Icon size={17} />}
              <span>{VIEW_TITLES[target]}</span><ChevronRight size={15} />
            </button>
          ))}
        </div>
      </aside>
    </main>
  );
}
