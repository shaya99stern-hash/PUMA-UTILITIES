'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, TouchEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  FileSearch,
  Globe2,
  Mail,
  Menu,
  Mic,
  Phone,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Waves,
  Wrench,
  X,
} from 'lucide-react';
import { addActivityNote, classifyPortfolioFit, summarizeMeterCoverage } from '@/lib/client-workflow';
import { buildMonitorAlerts } from '@/lib/monitor';
import { scoreBand, scoreCompany } from '@/lib/scoring';
import { mergeReleaseOneSeeds, WORKSPACE_RELEASE } from '@/lib/seed';
import { SOURCE_CATALOG } from '@/lib/sources';
import type {
  Company,
  InstallationStatus,
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
type VoiceStatus = 'idle' | 'listening' | 'saved' | 'unsupported' | 'error';

type SpeechResult = {
  length: number;
  [index: number]: { transcript?: string };
};

type SpeechResultList = {
  length: number;
  [index: number]: SpeechResult;
};

type VoiceRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: SpeechResultList }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type VoiceRecognitionCtor = new () => VoiceRecognition;

const PRIMARY_VIEWS: PumaView[] = ['home', 'clients', 'monitor'];

const VIEW_TITLES: Record<PumaView, string> = {
  home: 'Puma',
  clients: 'Leads & CRM',
  monitor: 'Monitor',
  engine: 'Research Engine',
  settings: 'Settings',
};

const STAGES: StageFilter[] = [
  'All',
  'Target',
  'Research',
  'Qualified',
  'Outreach',
  'Follow-up',
  'Pilot',
  'Installation',
  'Client',
];

const PIPELINE_STAGES: PipelineStage[] = [
  'Target',
  'Research',
  'Qualified',
  'Outreach',
  'Follow-up',
  'Pilot',
  'Installation',
  'Client',
  'Archived',
];

const INSTALLATION_STAGES: InstallationStatus[] = [
  'Not started',
  'Site visit',
  'Scheduled',
  'Installed',
  'Live',
];

const CONNECTOR_STATUS: Array<{ label: string; detail: string; status: string; icon: LucideIcon }> = [
  {
    label: 'Nationwide lead research',
    detail: 'The CRM and research model are nationwide. Automatic web discovery is not connected in this release, so sourced leads are added through verified research inputs.',
    status: 'Workflow ready',
    icon: Globe2,
  },
  {
    label: 'Email outreach',
    detail: 'Bulk outreach opens your default email client with known decision-maker addresses. Puma does not silently send mail.',
    status: 'Local handoff',
    icon: Mail,
  },
  {
    label: 'Voice notes',
    detail: 'Uses browser speech-to-text when available. Puma stores the transcript as a CRM note, not the audio recording.',
    status: 'Browser feature',
    icon: Mic,
  },
  {
    label: 'Client usage import',
    detail: 'Leak monitoring requires client-authorized readings, exports, or an approved integration. Public prospecting data never becomes a client meter feed.',
    status: 'Authorization required',
    icon: Waves,
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

function SectionLabel({ children }: { children: ReactNode }) {
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

function EvidencePill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'positive' | 'warning' }) {
  return <span className={`evidence-pill ${tone}`}>{children}</span>;
}

function Score({ score }: { score: OpportunityScore }) {
  if (score.total === undefined) return <span className="unscored-pill">Unscored</span>;
  return <span className={`score ${scoreBand(score.total).toLowerCase()}`}>{score.total}</span>;
}

function readableDate(value?: string) {
  if (!value) return 'Not logged';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not logged';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function publicSources(company: Company, properties: Property[]) {
  const byId = new Map<string, Provenance>();
  [...company.provenance, ...properties.flatMap((property) => property.provenance)].forEach((source) => byId.set(source.id, source));
  return [...byId.values()];
}

function formatPortfolio(company: Company) {
  if (!company.portfolio || company.portfolio.length === 0) return 'Portfolio fact not sourced';
  return company.portfolio
    .map((metric) => metric.statement ?? `${metric.value.toLocaleString()}${metric.qualifier === 'at-least' ? '+' : ''} ${metric.label}`)
    .join(' · ');
}

function factorCount(score: OpportunityScore) {
  return score.factors.filter((factor) => factor.state === 'evidenced').length;
}

function companyUtilities(company: Company, workspace: Workspace) {
  const propertyIds = new Set(workspace.properties.filter((property) => property.companyId === company.id).map((property) => property.id));
  return workspace.utilities.filter((utility) => propertyIds.has(utility.propertyId));
}

function utilityLabel(utility: UtilityService) {
  const capability = utility.capability === 'unknown' ? 'meter unknown' : utility.capability.replaceAll('-', ' ');
  const portal = utility.portal === 'unknown' ? 'portal unknown' : utility.portal.replaceAll('-', ' ');
  return `${capability} · ${portal}`;
}

function fitLabel(company: Company) {
  const fit = classifyPortfolioFit(company);
  if (fit.status === 'ideal') return { text: `${fit.count ?? '12+'} ${fit.basis ?? 'properties'} · ICP`, tone: 'positive' as const };
  if (fit.status === 'too-small') return { text: 'Below 12', tone: 'neutral' as const };
  if (fit.status === 'corporate-scale') return { text: 'Corporate scale', tone: 'warning' as const };
  return { text: 'Portfolio size unknown', tone: 'neutral' as const };
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

type CompanyDetailProps = {
  company: Company;
  workspace: Workspace;
  onStageChange: (stage: PipelineStage) => void;
  onInstallationChange: (status: InstallationStatus) => void;
  onAddNote: (text: string, source?: 'typed' | 'voice', propertyId?: string) => void;
  onLogCall: () => void;
  onVoice: (propertyId?: string) => void;
};

function CompanyDetail({
  company,
  workspace,
  onStageChange,
  onInstallationChange,
  onAddNote,
  onLogCall,
  onVoice,
}: CompanyDetailProps) {
  const [noteDraft, setNoteDraft] = useState('');
  const [propertyDrafts, setPropertyDrafts] = useState<Record<string, string>>({});
  const companyProperties = workspace.properties.filter((property) => property.companyId === company.id);
  const utilities = companyUtilities(company, workspace);
  const score = scoreCompany(company, workspace);
  const sources = publicSources(company, companyProperties);
  const sourceCount = sources.filter((source) => source.status === 'verified-public').length;
  const meterCoverage = summarizeMeterCoverage(companyProperties, utilities);
  const fit = fitLabel(company);

  const submitCompanyNote = () => {
    if (!noteDraft.trim()) return;
    onAddNote(noteDraft, 'typed');
    setNoteDraft('');
  };

  const submitPropertyNote = (propertyId: string) => {
    const text = propertyDrafts[propertyId]?.trim();
    if (!text) return;
    onAddNote(text, 'typed', propertyId);
    setPropertyDrafts((current) => ({ ...current, [propertyId]: '' }));
  };

  return (
    <>
      <div className="detail-page-heading">
        <Link href="/clients" className="back-button"><ChevronLeft size={18} />Leads & CRM</Link>
        <EvidencePill tone={fit.tone}>{fit.text}</EvidencePill>
      </div>

      <div className="detail-title route-detail-title">
        <div>
          <h1>{company.name}</h1>
          <p>{company.market ?? 'Market not logged'} · {company.stage}</p>
        </div>
        <Score score={score} />
      </div>
      <p className="detail-disclaimer">{company.notes ?? 'Public research only. Unknown fields are not negative findings.'}</p>

      <SectionLabel>Pipeline & installation</SectionLabel>
      <div className="workflow-grid">
        <label className="workflow-control">
          <span>Sales stage</span>
          <select value={company.stage} onChange={(event) => onStageChange(event.target.value as PipelineStage)}>
            {PIPELINE_STAGES.map((stage) => <option value={stage} key={stage}>{stage}</option>)}
          </select>
        </label>
        <label className="workflow-control">
          <span>Installation</span>
          <select value={company.installationStatus ?? 'Not started'} onChange={(event) => onInstallationChange(event.target.value as InstallationStatus)}>
            {INSTALLATION_STAGES.map((status) => <option value={status} key={status}>{status}</option>)}
          </select>
        </label>
      </div>
      <div className="quick-actions">
        <button type="button" onClick={onLogCall}><Phone size={15} />Log call</button>
        <button type="button" onClick={() => onVoice()}><Mic size={15} />Dictate note</button>
      </div>
      <p className="microcopy">Last contact: {readableDate(company.lastContactAt)}. Logging a call moves untouched research records into Outreach.</p>

      <SectionLabel>Decision makers</SectionLabel>
      {company.people.length === 0 ? (
        <div className="native-group"><div className="prose-group"><strong>No decision-maker contact sourced yet</strong><p>Research should prioritize owner/principal, operations, facilities, asset management, sustainability, or portfolio operations roles.</p></div></div>
      ) : (
        <div className="native-group list-group">
          {company.people.map((person) => (
            <div className="contact-row" key={person.id}>
              <span className="row-icon"><UserRound size={17} /></span>
              <span className="row-copy"><strong>{person.name}</strong><small>{person.role ?? 'Role not logged'}</small></span>
              <span className="contact-actions">
                {person.phone && <a href={`tel:${person.phone}`} aria-label={`Call ${person.name}`}><Phone size={15} /></a>}
                {person.email && <a href={`mailto:${person.email}`} aria-label={`Email ${person.name}`}><Mail size={15} /></a>}
              </span>
            </div>
          ))}
        </div>
      )}

      <SectionLabel>Portfolio</SectionLabel>
      <div className="native-group">
        <div className="prose-group">
          <strong>{formatPortfolio(company)}</strong>
          <p>{sourceCount > 0 ? `Portfolio statement supported by ${sourceCount} logged public source${sourceCount === 1 ? '' : 's'}.` : 'No portfolio source is logged.'}</p>
        </div>
      </div>

      <SectionLabel>Water utility & smart-meter coverage</SectionLabel>
      <div className="meter-summary">
        <div><strong>{meterCoverage.properties}</strong><span>properties mapped</span></div>
        <div><strong>{meterCoverage.smartReady}</strong><span>smart-ready</span></div>
        <div><strong>{meterCoverage.unknown}</strong><span>unknown</span></div>
        <div><strong>{meterCoverage.smartReadyPercentOfKnown === undefined ? '—' : `${meterCoverage.smartReadyPercentOfKnown}%`}</strong><span>of known</span></div>
      </div>
      {companyProperties.length === 0 ? (
        <div className="native-group">
          <div className="native-row static-row">
            <span className="row-icon"><FileSearch size={17} /></span>
            <span className="row-copy"><strong>No property-level records yet</strong><small>Addresses, water providers, and smart-meter status must be resolved property by property. Unknown does not mean “no smart meter.”</small></span>
          </div>
        </div>
      ) : (
        <div className="property-stack">
          {companyProperties.map((property) => {
            const propertyUtilities = utilities.filter((utility) => utility.propertyId === property.id);
            return (
              <article className="property-card" key={property.id}>
                <div className="property-card-head">
                  <div><strong>{property.name}</strong><small>{property.address.value ?? 'Address unknown'} · {property.state}</small></div>
                  <button type="button" className="mini-voice" onClick={() => onVoice(property.id)} aria-label={`Dictate note for ${property.name}`}><Mic size={14} /></button>
                </div>
                {propertyUtilities.length === 0 ? (
                  <p className="utility-unknown">Water provider and meter capability not yet verified.</p>
                ) : propertyUtilities.map((utility) => (
                  <div className="utility-line" key={utility.id}>
                    <span>{utility.provider}</span>
                    <EvidencePill tone={utility.capability === 'smart-meter' || utility.capability === 'newly-installed' ? 'positive' : 'neutral'}>{utilityLabel(utility)}</EvidencePill>
                  </div>
                ))}
                <div className="property-note-composer">
                  <input
                    value={propertyDrafts[property.id] ?? ''}
                    onChange={(event) => setPropertyDrafts((current) => ({ ...current, [property.id]: event.target.value }))}
                    placeholder="Add building note"
                    aria-label={`Add note for ${property.name}`}
                  />
                  <button type="button" onClick={() => submitPropertyNote(property.id)}>Save</button>
                </div>
                {(property.activityNotes ?? []).slice().reverse().slice(0, 2).map((note) => (
                  <div className="compact-note" key={note.id}><span>{note.source === 'voice' ? 'Voice' : 'Note'} · {readableDate(note.createdAt)}</span><p>{note.text}</p></div>
                ))}
              </article>
            );
          })}
        </div>
      )}

      <SectionLabel>CRM notes</SectionLabel>
      <div className="note-composer">
        <textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Call notes, next step, objection, installation detail…" />
        <div>
          <button type="button" className="secondary-action" onClick={() => onVoice()}><Mic size={15} />Dictate</button>
          <button type="button" className="primary-action" onClick={submitCompanyNote} disabled={!noteDraft.trim()}>Save note</button>
        </div>
      </div>
      {(company.activityNotes ?? []).length === 0 ? (
        <div className="native-group"><div className="prose-group"><strong>No CRM notes yet</strong><p>Typed and voice-transcribed notes stay attached to this company in the local workspace.</p></div></div>
      ) : (
        <div className="note-timeline">
          {(company.activityNotes ?? []).slice().reverse().map((note) => (
            <div className="note-entry" key={note.id}><span>{note.source === 'voice' ? 'Voice transcript' : 'Typed note'} · {readableDate(note.createdAt)}</span><p>{note.text}</p></div>
          ))}
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
      <div className="native-group"><div className="prose-group"><strong>{company.nextAction ?? 'Add a traceable public source before drawing a conclusion.'}</strong><p>Monitoring begins only after explicit client authorization and an approved usage source.</p></div></div>
    </>
  );
}

export default function PumaWorkspaceApp({ view, companyId }: PumaWorkspaceAppProps) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<StageFilter>('All');
  const [icpOnly, setIcpOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [exportStatus, setExportStatus] = useState<'idle' | 'done' | 'error'>('idle');
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [voiceTarget, setVoiceTarget] = useState('CRM inbox');
  const gesture = useRef<GestureStart | null>(null);
  const recognitionRef = useRef<VoiceRecognition | null>(null);
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

  const mutateWorkspace = (updater: (current: Workspace) => Workspace) => {
    setWorkspace((current) => {
      if (!current) return current;
      const next = updater(current);
      saveWorkspace(next);
      return next;
    });
  };

  const companies = useMemo(() => {
    if (!workspace) return [];
    return workspace.companies
      .map((company) => ({ company, score: scoreCompany(company, workspace), fit: classifyPortfolioFit(company) }))
      .sort((left, right) => {
        const leftRank = left.fit.status === 'ideal' ? 0 : left.fit.status === 'unknown' ? 1 : 2;
        const rightRank = right.fit.status === 'ideal' ? 0 : right.fit.status === 'unknown' ? 1 : 2;
        return leftRank - rightRank || left.company.name.localeCompare(right.company.name);
      });
  }, [workspace]);

  const filteredCompanies = useMemo(() => companies.filter(({ company, fit }) => {
    const lowered = query.toLowerCase().trim();
    const personMatch = company.people.some((person) => `${person.name} ${person.role ?? ''}`.toLowerCase().includes(lowered));
    const queryMatches = !lowered || company.name.toLowerCase().includes(lowered) || company.market?.toLowerCase().includes(lowered) || personMatch;
    const stageMatches = stageFilter === 'All' || company.stage === stageFilter;
    const fitMatches = !icpOnly || fit.status === 'ideal';
    return queryMatches && stageMatches && fitMatches;
  }), [companies, query, stageFilter, icpOnly]);

  const selectedCompany = companyId && workspace ? workspace.companies.find((company) => company.id === companyId) : undefined;
  const alerts = workspace ? buildMonitorAlerts(workspace) : [];
  const activeClientCount = workspace?.companies.filter((company) => company.stage === 'Client').length ?? 0;
  const pipelineCount = workspace?.companies.filter((company) => !['Client', 'Archived'].includes(company.stage)).length ?? 0;
  const installationQueue = workspace?.companies.filter((company) => company.installationStatus && company.installationStatus !== 'Not started') ?? [];
  const inboxNotes = workspace?.inboxNotes ?? [];

  const closeMenu = () => {
    setMenuOpen(false);
    window.setTimeout(() => menuButtonRef.current?.focus(), 0);
  };

  const moveTo = (next: PumaView) => {
    closeMenu();
    router.push(routeFor(next));
  };

  const updateCompany = (id: string, patch: Partial<Company>) => {
    const now = new Date().toISOString();
    mutateWorkspace((current) => ({
      ...current,
      companies: current.companies.map((company) => company.id === id ? { ...company, ...patch, updatedAt: now } : company),
      updatedAt: now,
    }));
  };

  const addNote = (text: string, source: 'typed' | 'voice' = 'typed', targetCompanyId?: string, propertyId?: string) => {
    mutateWorkspace((current) => addActivityNote(current, { text, source, companyId: targetCompanyId, propertyId }));
  };

  const startVoiceCapture = (targetCompanyId?: string, propertyId?: string) => {
    if (voiceStatus === 'listening') {
      recognitionRef.current?.stop();
      return;
    }
    const voiceWindow = window as typeof window & {
      SpeechRecognition?: VoiceRecognitionCtor;
      webkitSpeechRecognition?: VoiceRecognitionCtor;
    };
    const Recognition = voiceWindow.SpeechRecognition ?? voiceWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceStatus('unsupported');
      setVoiceTarget('Speech-to-text is not available in this browser');
      return;
    }

    const company = targetCompanyId ? workspace?.companies.find((item) => item.id === targetCompanyId) : undefined;
    const property = propertyId ? workspace?.properties.find((item) => item.id === propertyId) : undefined;
    setVoiceTarget(property?.name ?? company?.name ?? 'CRM inbox');
    setVoiceStatus('listening');
    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    let transcript = '';

    recognition.onresult = (event) => {
      const parts: string[] = [];
      for (let index = 0; index < event.results.length; index += 1) {
        const text = event.results[index]?.[0]?.transcript?.trim();
        if (text) parts.push(text);
      }
      transcript = parts.join(' ').trim();
    };
    recognition.onerror = () => {
      setVoiceStatus('error');
      recognitionRef.current = null;
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (transcript) {
        addNote(transcript, 'voice', targetCompanyId, propertyId);
        setVoiceStatus('saved');
        window.setTimeout(() => setVoiceStatus('idle'), 1800);
      } else {
        setVoiceStatus((status) => status === 'error' ? 'error' : 'idle');
      }
    };
    try {
      recognition.start();
    } catch {
      setVoiceStatus('error');
      recognitionRef.current = null;
    }
  };

  const logCall = (company: Company) => {
    const now = new Date().toISOString();
    const nextStage = company.stage === 'Research' || company.stage === 'Target' ? 'Outreach' : company.stage;
    mutateWorkspace((current) => ({
      ...current,
      companies: current.companies.map((item) => item.id === company.id ? { ...item, lastContactAt: now, stage: nextStage, updatedAt: now } : item),
      updatedAt: now,
    }));
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedEmails = useMemo(() => {
    if (!workspace) return [];
    const emails = workspace.companies
      .filter((company) => selectedIds.has(company.id))
      .flatMap((company) => company.people.map((person) => person.email).filter((email): email is string => Boolean(email)));
    return [...new Set(emails)];
  }, [workspace, selectedIds]);

  const emailSelected = () => {
    if (selectedEmails.length === 0) return;
    const subject = encodeURIComponent('Water utility monitoring');
    const bcc = encodeURIComponent(selectedEmails.join(','));
    window.location.href = `mailto:?bcc=${bcc}&subject=${subject}`;
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
      await fetch(`${window.location.pathname}?_puma_refresh=${Date.now()}`, { method: 'GET', cache: 'no-store', headers: { 'x-puma-update': '1' } });
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

  const onTouchStart = (event: TouchEvent<HTMLElement>) => {
    if (companyId) return;
    const touch = event.touches[0];
    if (!touch) return;
    gesture.current = { x: touch.clientX, y: touch.clientY, edge: touch.clientX <= 24 };
  };

  const onTouchEnd = (event: TouchEvent<HTMLElement>) => {
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

  const updateLabel = updateStatus === 'checking' ? 'Checking…' : updateStatus === 'reloading' ? 'Updating…' : updateStatus === 'error' ? 'Try again' : 'Update App';
  const pageTitle = companyId ? 'Company' : VIEW_TITLES[view];
  const currentVoiceCompanyId = companyId && selectedCompany ? selectedCompany.id : undefined;

  return (
    <main className="app-shell" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <header className="appbar">
        <button ref={menuButtonRef} className="icon-button" onClick={() => setMenuOpen(true)} aria-label="Menu" aria-expanded={menuOpen} aria-controls="puma-navigation"><Menu size={18} /></button>
        <strong className="appbar-title">{pageTitle}</strong>
        <div className="mark-button" aria-label="Puma Utilities logo"><PumaMark /></div>
      </header>

      <section key={`${view}-${companyId ?? 'index'}`} className="screen">
        {!workspace ? (
          <EmptyState icon={RefreshCw} title="Opening workspace" detail="Loading the local Puma CRM workspace." />
        ) : view === 'home' ? (
          <>
            <div className="home-intro">
              <PumaMark size={42} />
              <div><h1>Puma Utilities</h1><p>Nationwide multifamily water prospecting, CRM & monitoring</p></div>
            </div>

            <div className="research-profile">
              <div className="research-profile-head"><span>Ideal lead profile</span><strong>12–250 properties</strong></div>
              <div className="research-chips"><span>USA nationwide</span><span>Property management / real estate</span><span>~20 leads per research run</span><span>Public-source enrichment</span></div>
              <p>Find operators large enough to have a real portfolio, but small enough to avoid a deep corporate ladder. For every property, resolve the address, water provider, smart-meter capability, and useful public water data without treating unknowns as negative findings.</p>
              <Link className="research-cta" href="/clients">Open lead queue <ChevronRight size={15} /></Link>
            </div>

            <SectionLabel>Sales workspace</SectionLabel>
            <div className="native-group">
              <Link className="native-row" href="/clients">
                <span className="row-icon"><Building2 size={17} /></span>
                <span className="row-copy"><strong>Leads & CRM</strong><small>{pipelineCount} in pipeline · {activeClientCount} active clients</small></span>
                <ChevronRight className="chevron" size={16} />
              </Link>
              <Link className="native-row" href="/monitor">
                <span className="row-icon"><Activity size={17} /></span>
                <span className="row-copy"><strong>Install & Monitor</strong><small>{installationQueue.length} installation records · {alerts.length} authorized alerts</small></span>
                <ChevronRight className="chevron" size={16} />
              </Link>
            </div>

            <SectionLabel>System</SectionLabel>
            <div className="native-group">
              <Link className="native-row" href="/engine"><span className="row-icon"><SlidersHorizontal size={17} /></span><span className="row-copy"><strong>Research Engine</strong><small>ICP, public source registry, and property-level utility workflow</small></span><ChevronRight className="chevron" size={16} /></Link>
              <Link className="native-row" href="/settings"><span className="row-icon"><Settings size={17} /></span><span className="row-copy"><strong>Settings</strong><small>Voice, outreach, workspace, and app controls</small></span><ChevronRight className="chevron" size={16} /></Link>
            </div>

            {inboxNotes.length > 0 && (
              <><SectionLabel>Voice inbox</SectionLabel><div className="note-timeline">{inboxNotes.slice().reverse().slice(0, 3).map((note) => <div className="note-entry" key={note.id}><span>Voice transcript · {readableDate(note.createdAt)}</span><p>{note.text}</p></div>)}</div></>
            )}
            <div className="boundary-note"><ShieldCheck size={15} /><p>Public research drives lead qualification. Leak alerts require client-authorized usage data after the sale.</p></div>
          </>
        ) : view === 'clients' && companyId ? (
          selectedCompany ? (
            <CompanyDetail
              company={selectedCompany}
              workspace={workspace}
              onStageChange={(stage) => updateCompany(selectedCompany.id, { stage })}
              onInstallationChange={(installationStatus) => updateCompany(selectedCompany.id, { installationStatus })}
              onAddNote={(text, source = 'typed', propertyId) => addNote(text, source, selectedCompany.id, propertyId)}
              onLogCall={() => logCall(selectedCompany)}
              onVoice={(propertyId) => startVoiceCapture(selectedCompany.id, propertyId)}
            />
          ) : <EmptyState icon={CircleHelp} title="Company not found" detail="This local workspace does not contain that company. Return to Leads & CRM to choose a record." />
        ) : view === 'clients' ? (
          <>
            <div className="screen-heading"><h1>Leads & CRM</h1><span>{filteredCompanies.length} companies</span></div>
            <p className="screen-note">Nationwide lead workspace. Public research targets, active outreach, installations, and clients stay in one pipeline.</p>

            <div className="lead-controls">
              <label className="search-field"><Search size={16} /><input aria-label="Search companies" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, market, or contact" />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}</label>
              <button className={`icp-toggle ${icpOnly ? 'active' : ''}`} onClick={() => setIcpOnly((current) => !current)}><Check size={14} />12–250 only</button>
            </div>
            <div className="stage-filter" aria-label="Filter by stage">{STAGES.map((stage) => <button className={stage === stageFilter ? 'active' : ''} onClick={() => setStageFilter(stage)} key={stage}>{stage}</button>)}</div>

            {selectedIds.size > 0 && (
              <div className="selection-bar"><div><strong>{selectedIds.size} selected</strong><span>{selectedEmails.length} known email{selectedEmails.length === 1 ? '' : 's'}</span></div><button type="button" onClick={emailSelected} disabled={selectedEmails.length === 0}><Mail size={15} />Email selected</button></div>
            )}

            {filteredCompanies.length === 0 ? (
              <EmptyState icon={Building2} title="No matching companies" detail="Change the search, pipeline stage, or 12–250 property filter." />
            ) : (
              <div className="company-stack">
                {filteredCompanies.map(({ company, score }) => {
                  const fit = fitLabel(company);
                  const checked = selectedIds.has(company.id);
                  return (
                    <div className={`crm-company-row ${checked ? 'selected' : ''}`} key={company.id}>
                      <button type="button" className={`select-lead ${checked ? 'checked' : ''}`} onClick={() => toggleSelected(company.id)} aria-label={`${checked ? 'Deselect' : 'Select'} ${company.name}`}>{checked && <Check size={14} />}</button>
                      <Link className="crm-company-link" href={`/clients/${company.id}`}>
                        <span className="row-copy"><strong>{company.name}</strong><small>{company.market ?? 'Market unknown'} · {formatPortfolio(company)}</small><span className="company-meta"><EvidencePill tone={fit.tone}>{fit.text}</EvidencePill><EvidencePill tone="warning">{company.stage}</EvidencePill><span>{company.people.length} contacts</span></span></span>
                        <Score score={score} />
                        <ChevronRight className="chevron" size={16} />
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : view === 'monitor' ? (
          <>
            <div className="screen-heading"><h1>Install & Monitor</h1><span>Client operations</span></div>
            <SectionLabel>Installation pipeline</SectionLabel>
            {installationQueue.length === 0 ? (
              <EmptyState icon={Wrench} title="No installations logged" detail="Move a lead into Pilot or Installation and set its installation status from the company record." />
            ) : (
              <div className="native-group list-group">{installationQueue.map((company) => <Link className="native-row" href={`/clients/${company.id}`} key={company.id}><span className="row-icon"><Wrench size={17} /></span><span className="row-copy"><strong>{company.name}</strong><small>{company.installationStatus} · {company.stage}</small></span><ChevronRight className="chevron" size={16} /></Link>)}</div>
            )}

            <SectionLabel>Leak & usage alerts</SectionLabel>
            <div className="boundary-note"><ShieldCheck size={15} /><p>Only Client-stage companies with client-authorized readings are evaluated. Public research never produces an alert.</p></div>
            {alerts.length === 0 ? (
              <EmptyState icon={Activity} title="No client alerts" detail="No client-authorized readings currently trigger leak, spend, or unexpected-use rules." />
            ) : (
              <div className="native-group list-group">{alerts.map((alert) => { const company = workspace.companies.find((item) => item.id === alert.companyId); return <div className="alert-row" key={alert.id}><EvidencePill tone="positive">Authorized</EvidencePill><strong>{alert.title}</strong><small>{company?.name ?? 'Client'} · {alert.kind} · {alert.periodEnd ? readableDate(alert.periodEnd) : 'period not logged'}</small><p>{alert.detail}</p></div>; })}</div>
            )}
          </>
        ) : view === 'engine' ? (
          <>
            <div className="screen-heading"><h1>Research Engine</h1><span>Lead discovery blueprint</span></div>
            <div className="research-profile compact-profile"><div className="research-profile-head"><span>Default research brief</span><strong>20 leads</strong></div><div className="research-chips"><span>USA</span><span>12+ properties</span><span>Avoid corporate-scale</span><span>Decision makers</span><span>Addresses</span><span>Water utility</span><span>Smart-meter capability</span></div><p>Each research run should create CRM-ready company records, then enrich property-by-property. Utility and smart-meter facts must be traceable to an address/service territory or retained source. A company-level assumption is not enough.</p></div>
            <div className="engine-intro"><Globe2 size={17} /><p>The current built-in official source catalog starts with NJ/NY/PA references; the data model and CRM are nationwide. Additional state and utility sources can be added without changing the lead workflow.</p></div>
            <SectionLabel>Official source catalog</SectionLabel>
            <div className="native-group source-catalog">{SOURCE_CATALOG.map((source) => <div className="catalog-row" key={source.id}><div><strong>{source.name}</strong><small>{source.markets.join(' / ')} · {source.kind} · {source.access}</small><p>{source.description}</p></div><a className="source-link" href={source.url} target="_blank" rel="noreferrer">Open</a></div>)}</div>
            <SectionLabel>Scoring boundary</SectionLabel>
            <div className="native-group"><div className="prose-group"><strong>Evidence-gated opportunity scoring</strong><p>The ideal-company filter and opportunity score are separate: 12–250 is the default sales profile, while water opportunity still requires sourced property and utility evidence. Unknown is never treated as zero.</p></div></div>
            <SectionLabel>Monitoring handoff</SectionLabel>
            <div className="native-group"><div className="prose-group"><strong>Research → outreach → installation → authorized monitoring</strong><p>The same CRM record follows the account through the sale. Only an explicit client-authorized meter/bill/export source can create leak alerts.</p></div></div>
          </>
        ) : (
          <>
            <div className="screen-heading"><h1>Settings</h1><span>App controls</span></div>
            <SectionLabel>Workflow capabilities</SectionLabel>
            <div className="native-group list-group">{CONNECTOR_STATUS.map(({ label, detail, status, icon: Icon }) => <div className="native-row static-row" key={label}><span className="row-icon"><Icon size={17} /></span><span className="row-copy"><strong>{label}</strong><small>{detail}</small></span><span className="row-status">{status}</span></div>)}</div>
            <SectionLabel>Local workspace</SectionLabel>
            <div className="native-group list-group">
              <div className="native-row static-row"><span className="row-icon"><ShieldCheck size={17} /></span><span className="row-copy"><strong>Stored on this device</strong><small>{WORKSPACE_RELEASE} · last saved {readableDate(workspace.updatedAt)} · app updates do not clear this workspace.</small></span></div>
              <button className="native-row" onClick={exportWorkspace}><span className="row-icon"><Download size={17} /></span><span className="row-copy"><strong>Export workspace</strong><small>Download a JSON copy of research, CRM notes, pipeline status, and authorized records.</small></span><ChevronRight className="chevron" size={16} /></button>
            </div>
            {exportStatus === 'done' && <div className="integration-note"><p>Workspace export started. Local data remains in the app.</p></div>}
            {exportStatus === 'error' && <div className="integration-note"><p>Local persistence or export was unavailable. The open workspace has not been cleared.</p></div>}
            <SectionLabel>App</SectionLabel>
            <div className="native-group list-group"><button className="native-row" onClick={updateApp} disabled={updateStatus === 'checking' || updateStatus === 'reloading'}><span className="row-icon"><RefreshCw size={17} /></span><span className="row-copy"><strong>{updateLabel}</strong><small>Check the deployed app shell without clearing CRM data stored on this device.</small></span><ChevronRight className="chevron" size={16} /></button></div>
            {updateStatus === 'error' && <div className="integration-note"><p>Update check failed. Check the connection and tap Update App again.</p></div>}
          </>
        )}
      </section>

      <button className={`voice-dock ${voiceStatus}`} type="button" onClick={() => startVoiceCapture(currentVoiceCompanyId)} aria-label={voiceStatus === 'listening' ? 'Stop voice note' : 'Record voice note'}>
        <Mic size={18} />
        <span>{voiceStatus === 'listening' ? `Listening · ${voiceTarget}` : voiceStatus === 'saved' ? 'Voice note saved' : voiceStatus === 'unsupported' ? 'Voice unavailable' : voiceStatus === 'error' ? 'Voice error · tap to retry' : companyId && selectedCompany ? `Voice note · ${selectedCompany.name}` : 'Voice note'}</span>
      </button>

      <nav className="bottom-nav compact-nav" aria-label="Primary navigation">
        <Link className={view === 'home' ? 'active' : ''} href="/" aria-label="Home"><PumaMark size={25} nav /><span>Home</span></Link>
        <Link className={view === 'clients' ? 'active' : ''} href="/clients" aria-label="Leads"><Building2 size={18} /><span>CRM</span></Link>
        <Link className={view === 'monitor' ? 'active' : ''} href="/monitor" aria-label="Monitor"><Activity size={18} /><span>Monitor</span></Link>
      </nav>

      <div className={`menu-scrim ${menuOpen ? 'open' : ''}`} onClick={closeMenu} />
      <aside id="puma-navigation" className={`side-menu ${menuOpen ? 'open' : ''}`} aria-hidden={!menuOpen} aria-label="Puma navigation">
        <div className="menu-head"><div className="menu-brand"><PumaMark size={36} /><div><strong>Puma</strong><span>Utilities</span></div></div><button ref={menuCloseRef} className="icon-button" onClick={closeMenu} aria-label="Close menu"><X size={17} /></button></div>
        <div className="menu-nav">{([
          ['home', PumaMark],
          ['clients', Building2],
          ['monitor', Activity],
          ['engine', SlidersHorizontal],
          ['settings', Settings],
        ] as const).map(([target, Icon]) => <button onClick={() => moveTo(target)} className={view === target ? 'current' : ''} key={target}>{target === 'home' ? <PumaMark size={22} nav /> : <Icon size={17} />}<span>{VIEW_TITLES[target]}</span><ChevronRight size={15} /></button>)}</div>
      </aside>
    </main>
  );
}
