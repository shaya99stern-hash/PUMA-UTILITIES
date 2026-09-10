'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Mail,
  Menu,
  Mic,
  Phone,
  Search,
  Settings,
  SlidersHorizontal,
  UserRound,
  Waves,
  X,
} from 'lucide-react';
import { addActivityNote, summarizeMeterCoverage } from '@/lib/client-workflow';
import {
  clientSegmentFor,
  matchesProspectStatus,
  prospectStatusFor,
  type ClientSegment,
  type ProspectStatus,
} from '@/lib/client-presentation';
import { buildingDetailPath, buildingListPath, companyPath } from '@/lib/client-routing';
import { buildMonitorAlerts } from '@/lib/monitor';
import { mergeReleaseOneSeeds } from '@/lib/seed';
import type { Company, InstallationStatus, PipelineStage, Property, UtilityService, Workspace } from '@/lib/types';
import { nextVoicePhase, resolveVoiceDestination, type VoicePhase } from '@/lib/voice-notes';
import { loadWorkspace, saveWorkspace } from '@/lib/workspace';

export type PumaView = 'home' | 'clients' | 'monitor' | 'engine' | 'settings';
type ClientSubview = 'company' | 'buildings' | 'building';
type RecordTab = 'overview' | 'contacts' | 'activity';

type PumaWorkspaceAppProps = {
  view: PumaView;
  companyId?: string;
  propertyId?: string;
  subview?: ClientSubview;
};

type FriendlyStage = {
  label: 'Needs Outreach' | 'Contacted' | 'Follow-up' | 'Negotiation' | 'Installation' | 'Active Client';
  value: PipelineStage;
};

const APP_ICON = '/apple-touch-icon.png?v=20260910-3';
const PROSPECT_FILTERS: ProspectStatus[] = ['All', 'Needs Outreach', 'Contacted', 'Follow-up', 'Negotiation', 'Installation'];
const FRIENDLY_STAGES: FriendlyStage[] = [
  { label: 'Needs Outreach', value: 'Research' },
  { label: 'Contacted', value: 'Outreach' },
  { label: 'Follow-up', value: 'Follow-up' },
  { label: 'Negotiation', value: 'Qualified' },
  { label: 'Installation', value: 'Installation' },
  { label: 'Active Client', value: 'Client' },
];
const INSTALLATION_STAGES: InstallationStatus[] = ['Not started', 'Site visit', 'Scheduled', 'Installed', 'Live'];

function formatDate(value?: string) {
  if (!value) return 'Not logged';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not logged';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function portfolioSummary(company: Company) {
  if (company.portfolioBuildings.status !== 'unknown' && typeof company.portfolioBuildings.value === 'number') {
    return `${company.portfolioBuildings.value.toLocaleString()} buildings`;
  }
  const metric = company.portfolio?.find((item) => ['buildings', 'properties', 'communities'].includes(item.label) && item.status !== 'unknown');
  if (metric) return metric.statement ?? `${metric.value.toLocaleString()} ${metric.label}`;
  return 'Portfolio size not verified';
}

function clientLabel(company: Company) {
  return company.stage === 'Client' ? 'Active Client' : prospectStatusFor(company);
}

function utilityCapabilityLabel(utility?: UtilityService) {
  if (!utility || utility.capability === 'unknown') return 'Meter status unknown';
  if (utility.capability === 'smart-meter') return 'Smart meter';
  if (utility.capability === 'newly-installed') return 'New smart meter';
  return 'Manual read';
}

function utilityPortalLabel(utility?: UtilityService) {
  if (!utility || utility.portal === 'unknown') return 'Portal status unknown';
  if (utility.portal === 'authorized-interval') return 'Authorized interval data';
  if (utility.portal === 'public-portal') return 'Public portal';
  return 'Portal not visible';
}

function PumaMark({ size = 28 }: { size?: number }) {
  return <img className="puma-art-mark" src={APP_ICON} width={size} height={size} alt="" aria-hidden="true" />;
}

function SectionTitle({ children, trailing }: { children: React.ReactNode; trailing?: React.ReactNode }) {
  return <div className="puma-section-title"><strong>{children}</strong>{trailing}</div>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="puma-empty"><strong>{title}</strong><p>{detail}</p></div>;
}

function BottomNav({ view }: { view: PumaView }) {
  return (
    <nav className="puma-bottom-nav" aria-label="Primary navigation">
      <Link href="/" className={view === 'home' ? 'active' : ''} aria-label="Home"><PumaMark size={22} /><span>Home</span></Link>
      <Link href="/clients" className={view === 'clients' ? 'active' : ''} aria-label="Clients"><Building2 size={19} /><span>Clients</span></Link>
      <Link href="/monitor" className={view === 'monitor' ? 'active' : ''} aria-label="Monitor"><Activity size={19} /><span>Monitor</span></Link>
    </nav>
  );
}

function propertyUtilities(property: Property, workspace: Workspace) {
  return workspace.utilities.filter((utility) => utility.propertyId === property.id);
}

function companyProperties(company: Company, workspace: Workspace) {
  return workspace.properties.filter((property) => property.companyId === company.id);
}

function companyUtilities(company: Company, workspace: Workspace) {
  const propertyIds = new Set(companyProperties(company, workspace).map((property) => property.id));
  return workspace.utilities.filter((utility) => propertyIds.has(utility.propertyId));
}

function VoiceReviewSheet({
  phase,
  message,
  draft,
  destination,
  onDraft,
  onSave,
  onCancel,
}: {
  phase: VoicePhase;
  message: string;
  draft: string;
  destination: string;
  onDraft: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  if (phase !== 'review') return null;
  return (
    <div className="puma-sheet-scrim" role="presentation">
      <section className="puma-voice-sheet" role="dialog" aria-modal="true" aria-label="Review voice note">
        <div className="puma-sheet-handle" />
        <div className="puma-sheet-heading"><div><strong>Voice note</strong><span>Saving to {destination}</span></div><button type="button" onClick={onCancel} aria-label="Cancel voice note"><X size={18} /></button></div>
        {message && <p className="puma-voice-message">{message}</p>}
        <textarea value={draft} onChange={(event) => onDraft(event.target.value)} placeholder="Review the transcript or type the note here…" autoFocus />
        <div className="puma-sheet-actions"><button type="button" className="secondary" onClick={onCancel}>Cancel</button><button type="button" className="primary" disabled={!draft.trim()} onClick={onSave}>Save note</button></div>
      </section>
    </div>
  );
}

export default function PumaWorkspaceApp({ view, companyId, propertyId, subview = 'company' }: PumaWorkspaceAppProps) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [clientSegment, setClientSegment] = useState<ClientSegment>('prospects');
  const [prospectStatus, setProspectStatus] = useState<ProspectStatus>('All');
  const [recordTab, setRecordTab] = useState<RecordTab>('overview');
  const [noteDraft, setNoteDraft] = useState('');
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle');
  const [voiceDraft, setVoiceDraft] = useState('');
  const [voiceMessage, setVoiceMessage] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    const loaded = loadWorkspace();
    const hydrated = mergeReleaseOneSeeds(loaded);
    setWorkspace(hydrated);
    saveWorkspace(hydrated);
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => undefined);
  }, []);

  useEffect(() => () => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const mutateWorkspace = (updater: (current: Workspace) => Workspace) => {
    setWorkspace((current) => {
      if (!current) return current;
      const next = updater(current);
      saveWorkspace(next);
      return next;
    });
  };

  const selectedCompany = useMemo(() => workspace?.companies.find((company) => company.id === companyId), [workspace, companyId]);
  const selectedProperty = useMemo(
    () => workspace?.properties.find((property) => property.id === propertyId && (!companyId || property.companyId === companyId)),
    [workspace, propertyId, companyId],
  );

  const voiceDestination = resolveVoiceDestination({ companyId: selectedCompany?.id, propertyId: selectedProperty?.id });
  const voiceDestinationLabel = voiceDestination === 'property'
    ? selectedProperty?.name ?? 'building'
    : voiceDestination === 'company'
      ? selectedCompany?.name ?? 'client'
      : 'Voice Inbox';

  const addNote = (text: string, source: 'typed' | 'voice' = 'typed', targetCompanyId?: string, targetPropertyId?: string) => {
    mutateWorkspace((current) => addActivityNote(current, {
      text,
      source,
      companyId: targetCompanyId,
      propertyId: targetPropertyId,
    }));
  };

  const updateCompany = (id: string, patch: Partial<Company>) => {
    const updatedAt = new Date().toISOString();
    mutateWorkspace((current) => ({
      ...current,
      companies: current.companies.map((company) => company.id === id ? { ...company, ...patch, updatedAt } : company),
      updatedAt,
    }));
  };

  const logCall = (company: Company) => {
    const now = new Date().toISOString();
    const stage = company.stage === 'Target' || company.stage === 'Research' ? 'Outreach' : company.stage;
    mutateWorkspace((current) => addActivityNote({
      ...current,
      companies: current.companies.map((item) => item.id === company.id ? { ...item, stage, lastContactAt: now, updatedAt: now } : item),
      updatedAt: now,
    }, { text: 'Call logged', source: 'typed', companyId: company.id, now }));
  };

  const clearVoice = () => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
  };

  const processAudio = async (audio: Blob) => {
    setVoicePhase((current) => nextVoicePhase(current, 'STOP'));
    if (audio.size === 0) {
      setVoiceMessage('No audio was captured.');
      setVoicePhase('error');
      return;
    }
    const formData = new FormData();
    const extension = audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm';
    formData.append('audio', new File([audio], `puma-voice.${extension}`, { type: audio.type || 'audio/webm' }));
    try {
      const response = await fetch('/api/transcribe', { method: 'POST', body: formData, cache: 'no-store' });
      if (response.status === 501) {
        setVoiceDraft('');
        setVoiceMessage('Recording captured — transcription not configured.');
        setVoicePhase((current) => nextVoicePhase(current, 'TRANSCRIPT_READY'));
        return;
      }
      const payload = await response.json() as { transcript?: string; error?: string };
      if (!response.ok || !payload.transcript?.trim()) {
        setVoiceMessage('The recording was captured, but transcription failed.');
        setVoicePhase('error');
        return;
      }
      setVoiceDraft(payload.transcript.trim());
      setVoiceMessage('Review the transcript before saving.');
      setVoicePhase((current) => nextVoicePhase(current, 'TRANSCRIPT_READY'));
    } catch {
      setVoiceMessage('The recording was captured, but transcription failed.');
      setVoicePhase('error');
    }
  };

  const toggleVoice = async () => {
    if (voicePhase === 'recording') {
      const recorder = mediaRecorderRef.current;
      if (recorder?.state !== 'inactive') recorder?.stop();
      return;
    }
    if (voicePhase === 'requesting' || voicePhase === 'processing') return;
    setVoiceDraft('');
    setVoiceMessage('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceMessage('Microphone recording is not supported on this device.');
      setVoicePhase('unsupported');
      return;
    }
    setVoicePhase((current) => nextVoicePhase(current === 'saved' ? 'idle' : current, 'START'));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        clearVoice();
        setVoiceMessage('Microphone recording failed.');
        setVoicePhase('error');
      };
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || audioChunksRef.current[0]?.type || 'audio/webm';
        const audio = new Blob(audioChunksRef.current, { type: mimeType });
        clearVoice();
        void processAudio(audio);
      };
      recorder.start();
      setVoicePhase((current) => nextVoicePhase(current, 'PERMISSION_GRANTED'));
    } catch (error) {
      clearVoice();
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
        setVoiceMessage('Microphone permission was denied.');
        setVoicePhase((current) => nextVoicePhase(current, 'PERMISSION_DENIED'));
      } else {
        setVoiceMessage('Microphone recording could not start.');
        setVoicePhase('error');
      }
    }
  };

  const saveVoiceNote = () => {
    const text = voiceDraft.trim();
    if (!text) return;
    addNote(text, 'voice', selectedCompany?.id, selectedProperty?.id);
    setVoicePhase((current) => nextVoicePhase(current, 'SAVE'));
    setVoiceDraft('');
    setVoiceMessage('Saved');
    window.setTimeout(() => {
      setVoicePhase('idle');
      setVoiceMessage('');
    }, 1200);
  };

  const cancelVoice = () => {
    clearVoice();
    setVoiceDraft('');
    setVoiceMessage('');
    setVoicePhase((current) => nextVoicePhase(current, 'CANCEL'));
  };

  const allCompanies = workspace?.companies ?? [];
  const activeClients = allCompanies.filter((company) => company.stage === 'Client');
  const prospects = allCompanies.filter((company) => company.stage !== 'Client' && company.stage !== 'Archived');
  const alerts = workspace ? buildMonitorAlerts(workspace) : [];

  const visibleCompanies = useMemo(() => {
    if (!workspace) return [];
    const lower = query.trim().toLowerCase();
    return workspace.companies.filter((company) => {
      if (company.stage === 'Archived') return false;
      if (clientSegmentFor(company) !== clientSegment) return false;
      if (clientSegment === 'prospects' && !matchesProspectStatus(company, prospectStatus)) return false;
      if (!lower) return true;
      const people = company.people.map((person) => `${person.name} ${person.role ?? ''}`).join(' ').toLowerCase();
      return company.name.toLowerCase().includes(lower) || (company.market ?? '').toLowerCase().includes(lower) || people.includes(lower);
    });
  }, [workspace, query, clientSegment, prospectStatus]);

  const appTitle = 'Puma Utilities';
  const pageHeading = view === 'home' ? 'Home' : view === 'clients' ? 'Clients' : view === 'monitor' ? 'Monitor' : view === 'engine' ? 'Find Leads' : 'Settings';

  const renderHome = () => {
    if (!workspace) return <EmptyState title="Opening Puma" detail="Loading your local workspace." />;
    const inbox = workspace.inboxNotes ?? [];
    return (
      <div className="puma-page">
        <div className="puma-brand-hero"><PumaMark size={42} /><div><h1>Puma Utilities</h1><p>Water intelligence for multifamily portfolios.</p></div></div>
        <div className="puma-stat-strip"><div><strong>{prospects.length}</strong><span>Prospects</span></div><div><strong>{activeClients.length}</strong><span>Active Clients</span></div><div><strong>{alerts.length}</strong><span>Authorized Alerts</span></div></div>
        <SectionTitle>Workspace</SectionTitle>
        <div className="puma-list-group">
          <Link className="puma-list-row" href="/clients"><span className="puma-row-icon"><Building2 size={19} /></span><span className="puma-row-copy"><strong>Clients</strong><small>Prospects, follow-up, installation, and active clients</small></span><ChevronRight size={18} /></Link>
          <Link className="puma-list-row" href="/monitor"><span className="puma-row-icon"><Activity size={19} /></span><span className="puma-row-copy"><strong>Monitor</strong><small>Client-authorized leak and usage alerts</small></span><ChevronRight size={18} /></Link>
          <Link className="puma-list-row" href="/engine"><span className="puma-row-icon"><Search size={19} /></span><span className="puma-row-copy"><strong>Find Leads</strong><small>Research the next set of property-management prospects</small></span><ChevronRight size={18} /></Link>
        </div>
        {inbox.length > 0 && <><SectionTitle>Voice Inbox</SectionTitle><div className="puma-activity-list">{inbox.slice().reverse().slice(0, 4).map((note) => <article key={note.id}><span>{formatDate(note.createdAt)}</span><p>{note.text}</p></article>)}</div></>}
      </div>
    );
  };

  const renderClientsIndex = () => {
    if (!workspace) return <EmptyState title="Opening Clients" detail="Loading companies and pipeline data." />;
    return (
      <div className="puma-page">
        <div className="puma-page-head"><div><h1>Clients</h1><p>{clientSegment === 'prospects' ? `${prospects.length} prospects` : `${activeClients.length} active clients`}</p></div><Link className="puma-find-leads" href="/engine">Find Leads</Link></div>
        <div className="puma-segmented" role="tablist" aria-label="Client segment"><button type="button" className={clientSegment === 'prospects' ? 'active' : ''} onClick={() => setClientSegment('prospects')}>Prospects</button><button type="button" className={clientSegment === 'active' ? 'active' : ''} onClick={() => setClientSegment('active')}>Active Clients</button></div>
        {clientSegment === 'prospects' && <div className="puma-filter-scroll" aria-label="Prospect status">{PROSPECT_FILTERS.map((status) => <button key={status} type="button" className={prospectStatus === status ? 'active' : ''} onClick={() => setProspectStatus(status)}>{status}</button>)}</div>}
        <label className="puma-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, market, or contact" aria-label="Search clients" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={16} /></button>}</label>
        {visibleCompanies.length === 0 ? <EmptyState title="No matching companies" detail="Try another search or status filter." /> : <div className="puma-record-list">{visibleCompanies.map((company) => (
          <Link className="puma-record-row" href={companyPath(company.id)} key={company.id}>
            <span className="puma-record-main"><strong>{company.name}</strong><small>{portfolioSummary(company)}{company.market ? ` · ${company.market}` : ''}</small><span>{clientLabel(company)}{company.nextAction ? ` · ${company.nextAction}` : ''}</span></span>
            <ChevronRight size={18} />
          </Link>
        ))}</div>}
      </div>
    );
  };

  const renderOverview = (company: Company) => {
    if (!workspace) return null;
    const properties = companyProperties(company, workspace);
    const utilities = companyUtilities(company, workspace);
    const meter = summarizeMeterCoverage(properties, utilities);
    return (
      <>
        <div className="puma-summary-card">
          <div><span>Status</span><strong>{clientLabel(company)}</strong></div><div><span>Portfolio</span><strong>{portfolioSummary(company)}</strong></div><div><span>Last contact</span><strong>{formatDate(company.lastContactAt)}</strong></div><div><span>Next action</span><strong>{company.nextAction ?? 'Not set'}</strong></div>
        </div>
        <SectionTitle>Pipeline</SectionTitle>
        <div className="puma-control-group">
          <label><span>Status</span><select value={company.stage === 'Client' ? 'Client' : FRIENDLY_STAGES.find((item) => item.label === clientLabel(company))?.value ?? company.stage} onChange={(event) => updateCompany(company.id, { stage: event.target.value as PipelineStage })}>{FRIENDLY_STAGES.map((stage) => <option key={stage.label} value={stage.value}>{stage.label}</option>)}</select></label>
          <label><span>Installation</span><select value={company.installationStatus ?? 'Not started'} onChange={(event) => updateCompany(company.id, { installationStatus: event.target.value as InstallationStatus })}>{INSTALLATION_STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select></label>
        </div>
        <SectionTitle>Buildings</SectionTitle>
        <Link className="puma-building-entry" href={buildingListPath(company.id)}><span><strong>{properties.length} mapped building{properties.length === 1 ? '' : 's'}</strong><small>Open addresses, utilities, meter status, and building notes</small></span><ChevronRight size={18} /></Link>
        <div className="puma-meter-strip"><div><strong>{meter.smartReady}</strong><span>Smart-ready</span></div><div><strong>{meter.manual}</strong><span>Manual</span></div><div><strong>{meter.unknown}</strong><span>Unknown</span></div></div>
        <details className="puma-research-details"><summary>Research details</summary><p>{company.notes ?? 'No additional research note is recorded.'}</p><p>{company.provenance.length} company source record{company.provenance.length === 1 ? '' : 's'} retained.</p></details>
      </>
    );
  };

  const renderContacts = (company: Company) => company.people.length === 0
    ? <EmptyState title="No contacts verified" detail="Published decision-maker contacts have not been added yet." />
    : <div className="puma-contact-list">{company.people.map((person) => <div className="puma-contact-row" key={person.id}><span className="puma-row-icon"><UserRound size={18} /></span><span className="puma-row-copy"><strong>{person.name}</strong><small>{person.role ?? 'Role not recorded'}</small></span><span className="puma-contact-actions">{person.phone && <a href={`tel:${person.phone}`} aria-label={`Call ${person.name}`}><Phone size={18} /></a>}{person.email && <a href={`mailto:${person.email}`} aria-label={`Email ${person.name}`}><Mail size={18} /></a>}</span></div>)}</div>;

  const renderActivity = (company: Company) => {
    const notes = company.activityNotes ?? [];
    return (
      <>
        <div className="puma-note-composer"><textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Add a client note…" /><button type="button" disabled={!noteDraft.trim()} onClick={() => { addNote(noteDraft, 'typed', company.id); setNoteDraft(''); }}>Save note</button></div>
        {notes.length === 0 ? <EmptyState title="No activity yet" detail="Calls, follow-ups, typed notes, and voice transcripts will appear here." /> : <div className="puma-activity-list">{notes.slice().reverse().map((note) => <article key={note.id}><span>{note.source === 'voice' ? 'Voice transcript' : 'Note'} · {formatDate(note.createdAt)}{note.propertyId ? ' · Building' : ' · Company'}</span><p>{note.text}</p></article>)}</div>}
      </>
    );
  };

  const renderCompany = () => {
    if (!workspace) return <EmptyState title="Opening client" detail="Loading the company record." />;
    if (!selectedCompany) return <EmptyState title="Client not found" detail="This company is not in the local Puma workspace." />;
    const company = selectedCompany;
    const firstPhone = company.people.find((person) => person.phone)?.phone;
    const firstEmail = company.people.find((person) => person.email)?.email;
    return (
      <div className="puma-page">
        <Link className="puma-back" href="/clients"><ChevronLeft size={18} />Clients</Link>
        <div className="puma-record-head"><div><h1>{company.name}</h1><p>{clientLabel(company)}{company.market ? ` · ${company.market}` : ''}</p></div></div>
        <div className="puma-record-actions"><button type="button" onClick={() => logCall(company)}><Phone size={18} /><span>Log call</span></button>{firstPhone ? <a href={`tel:${firstPhone}`}><Phone size={18} /><span>Call</span></a> : <button type="button" disabled><Phone size={18} /><span>Call</span></button>}{firstEmail ? <a href={`mailto:${firstEmail}`}><Mail size={18} /><span>Email</span></a> : <button type="button" disabled><Mail size={18} /><span>Email</span></button>}<button type="button" onClick={() => void toggleVoice()}><Mic size={18} /><span>Voice</span></button></div>
        <div className="puma-record-tabs"><button type="button" className={recordTab === 'overview' ? 'active' : ''} onClick={() => setRecordTab('overview')}>Overview</button><button type="button" className={recordTab === 'contacts' ? 'active' : ''} onClick={() => setRecordTab('contacts')}>Contacts</button><Link href={buildingListPath(company.id)}>Buildings</Link><button type="button" className={recordTab === 'activity' ? 'active' : ''} onClick={() => setRecordTab('activity')}>Activity</button></div>
        <div className="puma-record-panel">{recordTab === 'overview' ? renderOverview(company) : recordTab === 'contacts' ? renderContacts(company) : renderActivity(company)}</div>
      </div>
    );
  };

  const renderBuildings = () => {
    if (!workspace || !selectedCompany) return <EmptyState title="Buildings unavailable" detail="The client record could not be loaded." />;
    const properties = companyProperties(selectedCompany, workspace);
    return (
      <div className="puma-page">
        <Link className="puma-back" href={companyPath(selectedCompany.id)}><ChevronLeft size={18} />{selectedCompany.name}</Link>
        <div className="puma-page-head"><div><h1>Buildings</h1><p>{properties.length} mapped propert{properties.length === 1 ? 'y' : 'ies'}</p></div></div>
        {properties.length === 0 ? <EmptyState title="No buildings mapped" detail="Property addresses and utility records have not been added yet." /> : <div className="puma-record-list">{properties.map((property) => {
          const utilities = propertyUtilities(property, workspace);
          const utility = utilities[0];
          return <Link className="puma-building-row" href={buildingDetailPath(selectedCompany.id, property.id)} key={property.id}><span className="puma-record-main"><strong>{property.name}</strong><small>{property.address.value ?? 'Address unknown'}{property.state ? ` · ${property.state}` : ''}</small><span>{utility?.provider ?? 'Water utility unknown'} · {utilityCapabilityLabel(utility)}</span></span><ChevronRight size={18} /></Link>;
        })}</div>}
      </div>
    );
  };

  const renderBuilding = () => {
    if (!workspace || !selectedCompany || !selectedProperty) return <EmptyState title="Building not found" detail="This property is not available in the selected client record." />;
    const utilities = propertyUtilities(selectedProperty, workspace);
    const utility = utilities[0];
    const propertyAlerts = alerts.filter((alert) => alert.propertyId === selectedProperty.id);
    const notes = selectedProperty.activityNotes ?? [];
    return (
      <div className="puma-page">
        <Link className="puma-back" href={buildingListPath(selectedCompany.id)}><ChevronLeft size={18} />Buildings</Link>
        <div className="puma-record-head"><div><h1>{selectedProperty.name}</h1><p>{selectedProperty.address.value ?? 'Address unknown'}{selectedProperty.state ? ` · ${selectedProperty.state}` : ''}</p></div></div>
        <div className="puma-building-facts"><div><span>Water provider</span><strong>{utility?.provider ?? 'Unknown'}</strong></div><div><span>Meter</span><strong>{utilityCapabilityLabel(utility)}</strong></div><div><span>Data access</span><strong>{utilityPortalLabel(utility)}</strong></div><div><span>Installation</span><strong>{selectedCompany.installationStatus ?? 'Not started'}</strong></div></div>
        <SectionTitle>Monitoring</SectionTitle>
        {propertyAlerts.length > 0 ? <Link className="puma-monitor-handoff" href="/monitor"><span><strong>{propertyAlerts.length} authorized alert{propertyAlerts.length === 1 ? '' : 's'}</strong><small>Open Monitor to review client-authorized usage signals.</small></span><ChevronRight size={18} /></Link> : <div className="puma-boundary"><Waves size={18} /><p>No client-authorized alert is active for this building. Public research data does not create monitoring alerts.</p></div>}
        <SectionTitle>Building notes</SectionTitle>
        <div className="puma-note-composer"><textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Add a building note…" /><button type="button" disabled={!noteDraft.trim()} onClick={() => { addNote(noteDraft, 'typed', selectedCompany.id, selectedProperty.id); setNoteDraft(''); }}>Save note</button></div>
        {notes.length > 0 && <div className="puma-activity-list">{notes.slice().reverse().map((note) => <article key={note.id}><span>{note.source === 'voice' ? 'Voice transcript' : 'Note'} · {formatDate(note.createdAt)}</span><p>{note.text}</p></article>)}</div>}
      </div>
    );
  };

  const renderMonitor = () => {
    if (!workspace) return <EmptyState title="Opening Monitor" detail="Loading authorized client readings." />;
    return (
      <div className="puma-page"><div className="puma-page-head"><div><h1>Monitor</h1><p>Client-authorized water signals only</p></div></div>{alerts.length === 0 ? <EmptyState title="No active alerts" detail="Alerts appear only after an active client has authorized meter readings that meet configured conditions." /> : <div className="puma-alert-list">{alerts.map((alert) => <article key={alert.id}><span className="puma-row-icon"><CircleAlert size={18} /></span><span className="puma-row-copy"><strong>{alert.title}</strong><small>{alert.detail}</small></span><Link href={buildingDetailPath(alert.companyId, alert.propertyId)} aria-label="Open building"><ChevronRight size={18} /></Link></article>)}</div>}</div>
    );
  };

  const renderEngine = () => (
    <div className="puma-page"><div className="puma-page-head"><div><h1>Find Leads</h1><p>Nationwide property-management research</p></div></div><div className="puma-engine-state"><Search size={24} /><strong>Lead discovery connector not connected</strong><p>Puma can organize and enrich verified research records, but this PWA does not currently have a live web-search provider configured. It will not fabricate companies, contacts, utilities, or meter data.</p></div><SectionTitle>Target profile</SectionTitle><div className="puma-chip-grid"><span>12–250 properties</span><span>United States</span><span>Property management</span><span>Multifamily real estate</span><span>Public-source enrichment</span></div></div>
  );

  const renderSettings = () => (
    <div className="puma-page"><div className="puma-page-head"><div><h1>Settings</h1><p>Puma workspace and app controls</p></div></div><div className="puma-list-group"><div className="puma-list-row static"><span className="puma-row-icon"><Mic size={19} /></span><span className="puma-row-copy"><strong>Voice notes</strong><small>Records real microphone audio. Transcription requires a configured server provider.</small></span></div><div className="puma-list-row static"><span className="puma-row-icon"><Settings size={19} /></span><span className="puma-row-copy"><strong>Local workspace</strong><small>Client records remain stored in this browser unless an approved connected backend is added.</small></span></div></div></div>
  );

  let content: React.ReactNode;
  if (view === 'home') content = renderHome();
  else if (view === 'clients' && subview === 'buildings') content = renderBuildings();
  else if (view === 'clients' && subview === 'building') content = renderBuilding();
  else if (view === 'clients' && companyId) content = renderCompany();
  else if (view === 'clients') content = renderClientsIndex();
  else if (view === 'monitor') content = renderMonitor();
  else if (view === 'engine') content = renderEngine();
  else content = renderSettings();

  const voiceBusy = voicePhase === 'requesting' || voicePhase === 'processing';
  const voiceRecording = voicePhase === 'recording';

  return (
    <main className="puma-shell">
      <header className="puma-appbar">
        <button type="button" className="puma-icon-button" onClick={() => setMenuOpen(true)} aria-label="Menu" aria-expanded={menuOpen}><Menu size={20} /></button>
        <div className="puma-app-brand"><PumaMark size={25} /><span><strong>{appTitle}</strong><small>{pageHeading}</small></span></div>
        <button type="button" className={`puma-voice-trigger ${voiceRecording ? 'recording' : ''}`} onClick={() => void toggleVoice()} disabled={voiceBusy} aria-label={voiceRecording ? 'Stop recording voice note' : 'Record voice note'}><Mic size={20} /></button>
      </header>

      <section className="puma-content">{content}</section>

      {(voicePhase === 'requesting' || voicePhase === 'recording' || voicePhase === 'processing' || voicePhase === 'permission-denied' || voicePhase === 'unsupported' || voicePhase === 'error' || voicePhase === 'saved') && (
        <div className={`puma-voice-status ${voicePhase}`} role="status">
          <Mic size={16} />
          <span>{voicePhase === 'requesting' ? 'Requesting microphone…' : voicePhase === 'recording' ? `Recording for ${voiceDestinationLabel} — tap mic to stop` : voicePhase === 'processing' ? 'Processing recording…' : voicePhase === 'saved' ? 'Voice note saved' : voiceMessage}</span>
          {['permission-denied', 'unsupported', 'error'].includes(voicePhase) && <button type="button" onClick={cancelVoice}><X size={15} /></button>}
        </div>
      )}

      <BottomNav view={view} />

      <div className={`puma-menu-scrim ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)} />
      <aside className={`puma-side-menu ${menuOpen ? 'open' : ''}`} aria-hidden={!menuOpen}>
        <div className="puma-side-head"><div className="puma-app-brand"><PumaMark size={30} /><span><strong>Puma Utilities</strong><small>Water Intelligence</small></span></div><button type="button" className="puma-icon-button" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={20} /></button></div>
        <nav><Link href="/" onClick={() => setMenuOpen(false)}><PumaMark size={20} /><span>Home</span></Link><Link href="/clients" onClick={() => setMenuOpen(false)}><Building2 size={19} /><span>Clients</span></Link><Link href="/monitor" onClick={() => setMenuOpen(false)}><Activity size={19} /><span>Monitor</span></Link><Link href="/engine" onClick={() => setMenuOpen(false)}><SlidersHorizontal size={19} /><span>Find Leads</span></Link><Link href="/settings" onClick={() => setMenuOpen(false)}><Settings size={19} /><span>Settings</span></Link></nav>
      </aside>

      <VoiceReviewSheet phase={voicePhase} message={voiceMessage} draft={voiceDraft} destination={voiceDestinationLabel} onDraft={setVoiceDraft} onSave={saveVoiceNote} onCancel={cancelVoice} />
    </main>
  );
}
