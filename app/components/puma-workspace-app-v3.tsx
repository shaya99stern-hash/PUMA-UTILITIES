'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bell,
  Building2,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Mail,
  Menu,
  Mic,
  Search,
  Settings,
  SlidersHorizontal,
  UserRound,
  X,
} from 'lucide-react';
import { addActivityNote } from '@/lib/client-workflow';
import { buildingDetailPath, buildingListPath, companyPath } from '@/lib/client-routing';
import { buildMonitorAlerts } from '@/lib/monitor';
import { mergeReleaseOneSeeds } from '@/lib/seed';
import type { Company, Property, UtilityService, Workspace } from '@/lib/types';
import { nextVoicePhase, resolveVoiceDestination, type VoicePhase } from '@/lib/voice-notes';
import { loadWorkspace, saveWorkspace } from '@/lib/workspace';

export type PumaView = 'home' | 'clients' | 'monitor' | 'engine' | 'settings';
type ClientSubview = 'company' | 'buildings' | 'building';
type RecordTab = 'overview' | 'contacts' | 'activity';
type Segment = 'prospects' | 'active';
type PipelineFilter = 'All' | 'Needs Outreach' | 'Contacted' | 'Follow-up' | 'Negotiation' | 'Installation';
type CompanyWithFollowUp = Company & { followUpAt?: string };

type PumaWorkspaceAppProps = {
  view: PumaView;
  companyId?: string;
  propertyId?: string;
  subview?: ClientSubview;
};

const APP_ICON = '/apple-touch-icon.png?v=20260910-3';
const PROFILE_KEY = 'puma-profile-name';
const PIPELINE_FILTERS: PipelineFilter[] = ['All', 'Needs Outreach', 'Contacted', 'Follow-up', 'Negotiation', 'Installation'];

function localDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatClock(date: Date) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
}

function formatLongDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(date);
}

function formatShortDate(value?: string) {
  if (!value) return 'Not set';
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return 'Not set';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parsed);
}

function portfolioSummary(company: Company) {
  if (company.portfolioBuildings.status !== 'unknown' && typeof company.portfolioBuildings.value === 'number') {
    return `${company.portfolioBuildings.value.toLocaleString()} buildings`;
  }
  const metric = company.portfolio?.find((item) => ['buildings', 'properties', 'communities'].includes(item.label) && item.status !== 'unknown');
  if (metric) return metric.statement ?? `${metric.value.toLocaleString()} ${metric.label}`;
  return 'Portfolio not verified';
}

function prospectStage(company: Company): Exclude<PipelineFilter, 'All'> {
  if (company.stage === 'Outreach') return 'Contacted';
  if (company.stage === 'Follow-up' || company.stage === 'Pilot') return 'Follow-up';
  if (company.stage === 'Qualified') return 'Negotiation';
  if (company.stage === 'Installation') return 'Installation';
  return 'Needs Outreach';
}

function companyProperties(company: Company, workspace: Workspace) {
  return workspace.properties.filter((property) => property.companyId === company.id);
}

function propertyUtilities(property: Property, workspace: Workspace) {
  return workspace.utilities.filter((utility) => utility.propertyId === property.id);
}

function utilityCapabilityLabel(utility?: UtilityService) {
  if (!utility || utility.capability === 'unknown') return 'Meter status unknown';
  if (utility.capability === 'smart-meter') return 'Smart meter';
  if (utility.capability === 'newly-installed') return 'New smart meter';
  return 'Manual read';
}

function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span className="pm-brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <img src={APP_ICON} width={size * 2} height={size * 2} alt="" />
    </span>
  );
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
    <div className="pm-sheet-scrim">
      <section className="pm-sheet" role="dialog" aria-modal="true" aria-label="Review voice note">
        <div className="pm-sheet-handle" />
        <div className="pm-sheet-head">
          <div><strong>Voice note</strong><span>Saving to {destination}</span></div>
          <button type="button" onClick={onCancel} aria-label="Cancel"><X size={18} /></button>
        </div>
        {message && <p className="pm-muted">{message}</p>}
        <textarea value={draft} onChange={(event) => onDraft(event.target.value)} placeholder="Review the transcript or type the note here…" autoFocus />
        <div className="pm-sheet-actions"><button type="button" onClick={onCancel}>Cancel</button><button type="button" className="primary" disabled={!draft.trim()} onClick={onSave}>Save note</button></div>
      </section>
    </div>
  );
}

export default function PumaWorkspaceApp({ view, companyId, propertyId, subview = 'company' }: PumaWorkspaceAppProps) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [segment, setSegment] = useState<Segment>('prospects');
  const [pipelineFilter, setPipelineFilter] = useState<PipelineFilter>('All');
  const [recordTab, setRecordTab] = useState<RecordTab>('overview');
  const [noteDraft, setNoteDraft] = useState('');
  const [profileName, setProfileName] = useState('Pinny');
  const [profileDraft, setProfileDraft] = useState('Pinny');
  const [profileOpen, setProfileOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
  const [now, setNow] = useState<Date | null>(null);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle');
  const [voiceDraft, setVoiceDraft] = useState('');
  const [voiceMessage, setVoiceMessage] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    const loaded = mergeReleaseOneSeeds(loadWorkspace());
    setWorkspace(loaded);
    saveWorkspace(loaded);
    const storedName = window.localStorage.getItem(PROFILE_KEY)?.trim();
    if (storedName) {
      setProfileName(storedName);
      setProfileDraft(storedName);
    }
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => undefined);
  }, []);

  useEffect(() => () => mediaStreamRef.current?.getTracks().forEach((track) => track.stop()), []);

  const mutateWorkspace = (updater: (current: Workspace) => Workspace) => {
    setWorkspace((current) => {
      if (!current) return current;
      const next = updater(current);
      saveWorkspace(next);
      return next;
    });
  };

  const selectedCompany = useMemo(() => workspace?.companies.find((company) => company.id === companyId), [workspace, companyId]);
  const selectedProperty = useMemo(() => workspace?.properties.find((property) => property.id === propertyId && (!companyId || property.companyId === companyId)), [workspace, propertyId, companyId]);
  const allCompanies = workspace?.companies ?? [];
  const activeCompanies = allCompanies.filter((company) => company.stage === 'Client');
  const prospects = allCompanies.filter((company) => company.stage !== 'Client' && company.stage !== 'Archived');
  const alerts = workspace ? buildMonitorAlerts(workspace) : [];
  const todayKey = now ? localDayKey(now) : '';
  const followUpsToday = prospects.filter((company) => (company as CompanyWithFollowUp).followUpAt?.slice(0, 10) === todayKey).length;

  const voiceDestination = resolveVoiceDestination({ companyId: selectedCompany?.id, propertyId: selectedProperty?.id });
  const voiceDestinationLabel = voiceDestination === 'property'
    ? selectedProperty?.name ?? 'building'
    : voiceDestination === 'company'
      ? selectedCompany?.name ?? 'company'
      : 'Voice Inbox';

  const updateCompany = (id: string, patch: Partial<CompanyWithFollowUp>) => {
    const updatedAt = new Date().toISOString();
    mutateWorkspace((current) => ({
      ...current,
      companies: current.companies.map((company) => company.id === id ? { ...company, ...patch, updatedAt } : company),
      updatedAt,
    }));
  };

  const addNote = (text: string, source: 'typed' | 'voice' = 'typed', targetCompanyId?: string, targetPropertyId?: string) => {
    const cleaned = text.trim();
    if (!cleaned) return;
    mutateWorkspace((current) => addActivityNote(current, { text: cleaned, source, companyId: targetCompanyId, propertyId: targetPropertyId }));
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
      const payload = await response.json() as { transcript?: string };
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
      recorder.ondataavailable = (event) => { if (event.data.size > 0) audioChunksRef.current.push(event.data); };
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
    window.setTimeout(() => { setVoicePhase('idle'); setVoiceMessage(''); }, 1200);
  };

  const cancelVoice = () => {
    clearVoice();
    setVoiceDraft('');
    setVoiceMessage('');
    setVoicePhase((current) => nextVoicePhase(current, 'CANCEL'));
  };

  const saveProfile = () => {
    const cleaned = profileDraft.trim() || 'Pinny';
    setProfileName(cleaned);
    setProfileDraft(cleaned);
    window.localStorage.setItem(PROFILE_KEY, cleaned);
    setProfileOpen(false);
  };

  if (!workspace) {
    return <main className="pm-shell"><div className="pm-loading">Loading Puma…</div><style>{styles}</style></main>;
  }

  const visibleCompanies = (segment === 'active' ? activeCompanies : prospects)
    .filter((company) => segment === 'active' || pipelineFilter === 'All' || prospectStage(company) === pipelineFilter)
    .filter((company) => company.name.toLowerCase().includes(query.toLowerCase()) || (company.market ?? '').toLowerCase().includes(query.toLowerCase()));

  const selectedEmails = allCompanies
    .filter((company) => selectedCompanyIds.includes(company.id))
    .flatMap((company) => company.people.map((person) => person.email).filter((email): email is string => Boolean(email)));

  const renderHome = () => (
    <div className="pm-page pm-home">
      <section className="pm-welcome">
        <div className="pm-date-line">{now ? `${formatLongDate(now)} · ${formatClock(now)}` : 'Today'}</div>
        <h1>Welcome, {profileName}</h1>
      </section>
      <section className="pm-stat-strip" aria-label="Today at a glance">
        <Link href="/clients"><strong>{followUpsToday}</strong><span>Follow-Ups for Today</span></Link>
        <Link href="/clients"><strong>{activeCompanies.length}</strong><span>Active Clients</span></Link>
        <Link href="/monitor"><strong>{alerts.length}</strong><span>Alerts</span></Link>
      </section>
    </div>
  );

  const renderCompanies = () => (
    <div className="pm-page">
      <div className="pm-page-head">
        <div><h1>Companies</h1><p>Pipeline and active accounts</p></div>
        <button className="pm-text-button" type="button" onClick={() => { setBulkMode((value) => !value); setSelectedCompanyIds([]); }}>{bulkMode ? 'Done' : 'Select'}</button>
      </div>
      <div className="pm-segmented" role="tablist" aria-label="Company segment">
        <button className={segment === 'prospects' ? 'active' : ''} onClick={() => setSegment('prospects')} type="button">Prospects <span>{prospects.length}</span></button>
        <button className={segment === 'active' ? 'active' : ''} onClick={() => setSegment('active')} type="button">Active Clients <span>{activeCompanies.length}</span></button>
      </div>
      {segment === 'prospects' && (
        <div className="pm-filter-row">
          {PIPELINE_FILTERS.map((filter) => <button type="button" key={filter} className={pipelineFilter === filter ? 'active' : ''} onClick={() => setPipelineFilter(filter)}>{filter}</button>)}
        </div>
      )}
      <label className="pm-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search companies" /></label>
      <div className="pm-company-list">
        {visibleCompanies.length === 0 && <div className="pm-empty"><strong>No companies here yet.</strong><span>Saved companies will appear in this view.</span></div>}
        {visibleCompanies.map((company) => {
          const checked = selectedCompanyIds.includes(company.id);
          return (
            <div className="pm-company-row" key={company.id}>
              {bulkMode && <button type="button" className={`pm-check ${checked ? 'active' : ''}`} aria-label={`Select ${company.name}`} onClick={() => setSelectedCompanyIds((current) => checked ? current.filter((id) => id !== company.id) : [...current, company.id])}>{checked && <Check size={14} />}</button>}
              <Link href={companyPath(company.id)}>
                <span className="pm-company-copy"><strong>{company.name}</strong><small>{company.market || 'Location not verified'} · {portfolioSummary(company)}</small></span>
                <ChevronRight size={17} />
              </Link>
            </div>
          );
        })}
      </div>
      {bulkMode && selectedCompanyIds.length > 0 && (
        <div className="pm-bulk-bar"><span>{selectedCompanyIds.length} selected</span>{selectedEmails.length > 0 ? <a href={`mailto:${selectedEmails.join(',')}`}><Mail size={16} /> Email</a> : <span className="pm-muted">No published emails</span>}</div>
      )}
    </div>
  );

  const renderCompany = () => {
    const company = selectedCompany as CompanyWithFollowUp | undefined;
    if (!company) return <div className="pm-page"><div className="pm-empty"><strong>Company not found.</strong></div></div>;
    const properties = companyProperties(company, workspace);
    const accountStatus = company.stage === 'Client' ? 'Active Client' : 'Prospect';
    return (
      <div className="pm-page">
        <Link className="pm-back" href="/clients"><ChevronLeft size={17} /> Companies</Link>
        <div className="pm-record-head">
          <h1>{company.name}</h1>
          <div className="pm-office"><span>Corporate Office</span><strong>{company.headquarters.status !== 'unknown' && company.headquarters.value ? company.headquarters.value : 'Not publicly verified'}</strong></div>
        </div>
        <div className="pm-tabs">
          <button type="button" className={recordTab === 'overview' ? 'active' : ''} onClick={() => setRecordTab('overview')}>Overview</button>
          <button type="button" className={recordTab === 'contacts' ? 'active' : ''} onClick={() => setRecordTab('contacts')}>Contacts</button>
          <Link href={buildingListPath(company.id)}>Buildings <span>{properties.length}</span></Link>
          <button type="button" className={recordTab === 'activity' ? 'active' : ''} onClick={() => setRecordTab('activity')}>Activity</button>
        </div>
        {recordTab === 'overview' && (
          <div className="pm-detail-stack">
            <div className="pm-detail-row"><span>Status</span><strong>{accountStatus}</strong></div>
            <div className="pm-detail-row"><span>Portfolio</span><strong>{portfolioSummary(company)}</strong></div>
            <div className="pm-detail-row"><span>Follow-up</span><div className="pm-followup"><span>{formatShortDate(company.followUpAt)}</span><input type="date" value={company.followUpAt?.slice(0, 10) ?? ''} onChange={(event) => updateCompany(company.id, { followUpAt: event.target.value || undefined })} aria-label="Follow-up date" /></div></div>
            <Link className="pm-detail-link" href={buildingListPath(company.id)}><span><strong>Buildings</strong><small>{properties.length} building records currently saved</small></span><ChevronRight size={17} /></Link>
          </div>
        )}
        {recordTab === 'contacts' && (
          <div className="pm-detail-stack">
            {company.people.length === 0 && <div className="pm-empty"><strong>No published decision-makers saved.</strong></div>}
            {company.people.map((person) => <div className="pm-contact-row" key={person.id}><div><strong>{person.name}</strong><span>{person.role || 'Role not verified'}</span></div><div>{person.email && <a href={`mailto:${person.email}`}>{person.email}</a>}{person.phone && <a href={`tel:${person.phone}`}>{person.phone}</a>}</div></div>)}
          </div>
        )}
        {recordTab === 'activity' && (
          <div className="pm-activity">
            <div className="pm-note-box"><textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Add a client note…" /><button type="button" disabled={!noteDraft.trim()} onClick={() => { addNote(noteDraft, 'typed', company.id); setNoteDraft(''); }}>Add note</button></div>
            <div className="pm-timeline">{(company.activityNotes ?? []).length === 0 && <div className="pm-empty"><strong>No activity yet.</strong></div>}{[...(company.activityNotes ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((note) => <article key={note.id}><span>{new Date(note.createdAt).toLocaleDateString()}</span><p>{note.text}</p></article>)}</div>
          </div>
        )}
      </div>
    );
  };

  const renderBuildings = () => {
    if (!selectedCompany) return <div className="pm-page"><div className="pm-empty"><strong>Company not found.</strong></div></div>;
    const properties = companyProperties(selectedCompany, workspace);
    return (
      <div className="pm-page">
        <Link className="pm-back" href={companyPath(selectedCompany.id)}><ChevronLeft size={17} /> {selectedCompany.name}</Link>
        <div className="pm-page-head"><div><h1>Buildings</h1><p>{properties.length} saved records</p></div></div>
        <div className="pm-building-list">{properties.length === 0 && <div className="pm-empty"><strong>No building records saved.</strong></div>}{properties.map((property) => <Link key={property.id} href={buildingDetailPath(selectedCompany.id, property.id)}><span><strong>{property.name}</strong><small>{property.address.status !== 'unknown' && property.address.value ? property.address.value : property.state}</small></span><ChevronRight size={17} /></Link>)}</div>
      </div>
    );
  };

  const renderBuilding = () => {
    if (!selectedCompany || !selectedProperty) return <div className="pm-page"><div className="pm-empty"><strong>Building not found.</strong></div></div>;
    const utilities = propertyUtilities(selectedProperty, workspace);
    return (
      <div className="pm-page">
        <Link className="pm-back" href={buildingListPath(selectedCompany.id)}><ChevronLeft size={17} /> Buildings</Link>
        <div className="pm-record-head"><h1>{selectedProperty.name}</h1><div className="pm-office"><span>Address</span><strong>{selectedProperty.address.status !== 'unknown' && selectedProperty.address.value ? selectedProperty.address.value : `${selectedProperty.state} · address not verified`}</strong></div></div>
        <div className="pm-detail-stack">
          {utilities.length === 0 && <div className="pm-empty"><strong>No water utility record saved.</strong></div>}
          {utilities.map((utility) => <div className="pm-utility" key={utility.id}><div><span>Water Utility</span><strong>{utility.provider}</strong></div><div><span>Meter</span><strong>{utilityCapabilityLabel(utility)}</strong></div></div>)}
          {selectedCompany.stage === 'Client' && <Link className="pm-detail-link" href="/monitor"><span><strong>Monitor</strong><small>Open client-authorized readings and alerts</small></span><ChevronRight size={17} /></Link>}
        </div>
        <div className="pm-note-box"><textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Add a building note…" /><button type="button" disabled={!noteDraft.trim()} onClick={() => { addNote(noteDraft, 'typed', selectedCompany.id, selectedProperty.id); setNoteDraft(''); }}>Add note</button></div>
      </div>
    );
  };

  const renderMonitor = () => (
    <div className="pm-page">
      <div className="pm-page-head"><div><h1>Monitor</h1><p>Client-authorized water alerts</p></div></div>
      <div className="pm-alert-list">{alerts.length === 0 && <div className="pm-empty"><Bell size={20} /><strong>No alerts right now.</strong><span>Alerts appear only from authorized client readings.</span></div>}{alerts.map((alert) => { const property = workspace.properties.find((item) => item.id === alert.propertyId); return <article key={alert.id}><Bell size={17} /><div><strong>{alert.title}</strong><span>{property?.name || 'Building'} · {alert.detail}</span></div></article>; })}</div>
    </div>
  );

  const renderEngine = () => (
    <div className="pm-page">
      <div className="pm-page-head"><div><h1>Find Leads</h1><p>Nationwide property-management research</p></div></div>
      <div className="pm-engine-state"><Search size={24} /><strong>Lead discovery connector not connected</strong><p>Puma will not fabricate companies, contacts, utilities, meter data, or building facts. A live web-search provider still needs to be connected for automatic discovery.</p></div>
    </div>
  );

  const renderSettings = () => (
    <div className="pm-page">
      <div className="pm-page-head"><div><h1>Settings</h1><p>Workspace preferences</p></div></div>
      <button type="button" className="pm-settings-row" onClick={() => setProfileOpen(true)}><UserRound size={18} /><span><strong>Profile</strong><small>{profileName}</small></span><ChevronRight size={17} /></button>
      <div className="pm-settings-row static"><Bell size={18} /><span><strong>Monitoring</strong><small>Alerts require client-authorized readings</small></span></div>
    </div>
  );

  let content = renderHome();
  if (view === 'clients' && subview === 'buildings') content = renderBuildings();
  else if (view === 'clients' && subview === 'building') content = renderBuilding();
  else if (view === 'clients' && companyId) content = renderCompany();
  else if (view === 'clients') content = renderCompanies();
  else if (view === 'monitor') content = renderMonitor();
  else if (view === 'engine') content = renderEngine();
  else if (view === 'settings') content = renderSettings();

  return (
    <main className="pm-shell">
      <header className="pm-appbar">
        <button type="button" className="pm-icon-button" aria-label="Menu" onClick={() => setMenuOpen(true)}><Menu size={20} /></button>
        <div className="pm-brand"><BrandMark size={28} /><span><strong>Puma Utilities</strong><small>{view === 'clients' ? 'Companies' : view === 'monitor' ? 'Monitor' : view === 'engine' ? 'Find Leads' : view === 'settings' ? 'Settings' : 'Home'}</small></span></div>
        <button type="button" className={`pm-mic ${voicePhase === 'recording' ? 'recording' : ''}`} aria-label="Record voice note" onClick={() => void toggleVoice()}><Mic size={20} /></button>
      </header>

      <section className="pm-content">{content}</section>

      <nav className="pm-bottom-nav" aria-label="Primary navigation">
        <Link href="/" className={view === 'home' ? 'active' : ''}><BrandMark size={22} /><span>Home</span></Link>
        <Link href="/clients" className={view === 'clients' ? 'active' : ''}><Building2 size={19} /><span>Companies</span></Link>
        <Link href="/monitor" className={view === 'monitor' ? 'active' : ''}><Activity size={19} /><span>Monitor</span></Link>
      </nav>

      <div className={`pm-drawer-scrim ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)} />
      <aside className={`pm-drawer ${menuOpen ? 'open' : ''}`} aria-hidden={!menuOpen}>
        <div className="pm-drawer-head"><div className="pm-brand"><BrandMark size={30} /><span><strong>Puma Utilities</strong><small>Water Intelligence</small></span></div><button type="button" className="pm-icon-button" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={20} /></button></div>
        <nav className="pm-drawer-nav">
          <Link href="/" onClick={() => setMenuOpen(false)}><BrandMark size={20} /><span>Home</span></Link>
          <Link href="/clients" onClick={() => setMenuOpen(false)}><Building2 size={19} /><span>Companies</span></Link>
          <Link href="/monitor" onClick={() => setMenuOpen(false)}><Activity size={19} /><span>Monitor</span></Link>
          <Link href="/engine" onClick={() => setMenuOpen(false)}><SlidersHorizontal size={19} /><span>Find Leads</span></Link>
          <Link href="/settings" onClick={() => setMenuOpen(false)}><Settings size={19} /><span>Settings</span></Link>
        </nav>
        <button type="button" className="pm-profile-row" onClick={() => { setMenuOpen(false); setProfileOpen(true); }}><UserRound size={20} /><span><strong>Profile</strong><small>{profileName}</small></span><ChevronRight size={17} /></button>
      </aside>

      {profileOpen && <div className="pm-sheet-scrim"><section className="pm-sheet" role="dialog" aria-modal="true" aria-label="Profile"><div className="pm-sheet-handle" /><div className="pm-sheet-head"><div><strong>Profile</strong><span>Personalize your workspace</span></div><button type="button" onClick={() => setProfileOpen(false)} aria-label="Close"><X size={18} /></button></div><label className="pm-field"><span>Display name</span><input value={profileDraft} onChange={(event) => setProfileDraft(event.target.value)} placeholder="Pinny" autoFocus /></label><div className="pm-sheet-actions"><button type="button" onClick={() => { setProfileDraft(profileName); setProfileOpen(false); }}>Cancel</button><button type="button" className="primary" onClick={saveProfile}>Save</button></div></section></div>}

      <VoiceReviewSheet phase={voicePhase} message={voiceMessage} draft={voiceDraft} destination={voiceDestinationLabel} onDraft={setVoiceDraft} onSave={saveVoiceNote} onCancel={cancelVoice} />
      {voicePhase === 'requesting' && <div className="pm-toast">Requesting microphone…</div>}
      {voicePhase === 'recording' && <div className="pm-toast recording">Recording · tap the mic to stop</div>}
      {(voicePhase === 'error' || voicePhase === 'denied' || voicePhase === 'unsupported') && voiceMessage && <button type="button" className="pm-toast error" onClick={cancelVoice}>{voiceMessage}</button>}
      <style>{styles}</style>
    </main>
  );
}

const styles = `
:root { --pm-bg:#050607; --pm-panel:#0b0d0f; --pm-line:rgba(255,255,255,.09); --pm-text:#f5f5f3; --pm-muted:#878b91; --pm-orange:#e57a35; }
* { box-sizing:border-box; }
body { background:var(--pm-bg); color:var(--pm-text); }
.pm-shell { min-height:100svh; background:var(--pm-bg); color:var(--pm-text); padding-bottom:calc(88px + env(safe-area-inset-bottom)); }
.pm-appbar { position:sticky; top:0; z-index:30; height:calc(58px + env(safe-area-inset-top)); padding:calc(env(safe-area-inset-top) + 7px) 14px 7px; display:grid; grid-template-columns:44px 1fr 44px; align-items:center; gap:8px; background:rgba(5,6,7,.96); border-bottom:1px solid var(--pm-line); backdrop-filter:blur(14px); }
.pm-icon-button,.pm-mic { width:44px; height:44px; display:grid; place-items:center; border:0; border-radius:13px; color:#d6d7d8; background:transparent; }
.pm-mic.recording { background:rgba(229,122,53,.14); color:var(--pm-orange); }
.pm-brand { min-width:0; display:flex; align-items:center; gap:9px; background:transparent; }
.pm-brand > span:last-child { min-width:0; display:flex; flex-direction:column; gap:1px; }
.pm-brand strong { font-size:14px; font-weight:620; letter-spacing:-.01em; white-space:nowrap; }
.pm-brand small { font-size:10.5px; color:var(--pm-muted); }
.pm-brand-mark { position:relative; display:inline-block; overflow: hidden; flex:0 0 auto; background:#000; border-radius:5px; }
.pm-brand-mark img { position:absolute; width:148%; height:148%; max-width:none; object-fit:cover; object-position:center 3%; left:-24%; top:-9%; filter: contrast(260%) brightness(82%) saturate(220%); }
.pm-content { width:min(100%, 760px); margin:0 auto; }
.pm-page { padding:24px 16px 28px; }
.pm-home { padding-top:30px; }
.pm-loading { padding:30vh 20px 0; text-align:center; color:var(--pm-muted); }
.pm-welcome { padding:6px 2px 24px; }
.pm-date-line { font-size:12px; color:var(--pm-muted); margin-bottom:6px; }
.pm-welcome h1,.pm-page-head h1,.pm-record-head h1 { margin:0; font-size:26px; line-height:1.08; letter-spacing:-.035em; font-weight:650; }
.pm-stat-strip { display:grid; grid-template-columns:repeat(3,1fr); border:1px solid var(--pm-line); border-radius:16px; overflow:hidden; background:rgba(255,255,255,.018); }
.pm-stat-strip a { min-height:84px; padding:15px 11px; display:flex; flex-direction:column; justify-content:center; gap:5px; color:inherit; text-decoration:none; border-right:1px solid var(--pm-line); }
.pm-stat-strip a:last-child { border-right:0; }
.pm-stat-strip strong { font-size:20px; font-weight:650; }
.pm-stat-strip span { font-size:10.5px; line-height:1.25; color:var(--pm-muted); }
.pm-page-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:18px; }
.pm-page-head p { margin:5px 0 0; color:var(--pm-muted); font-size:12px; }
.pm-text-button { height:36px; padding:0 11px; border:0; border-radius:10px; color:#bbbfc3; background:rgba(255,255,255,.04); font-size:12px; }
.pm-segmented { display:grid; grid-template-columns:1fr 1fr; padding:3px; border:1px solid var(--pm-line); border-radius:12px; background:#080a0c; margin-bottom:12px; }
.pm-segmented button { min-height:38px; border:0; border-radius:9px; background:transparent; color:var(--pm-muted); font-size:12px; }
.pm-segmented button.active { color:var(--pm-text); background:#15181b; }
.pm-segmented span { margin-left:5px; color:#696e74; }
.pm-filter-row { display:flex; gap:6px; overflow-x:auto; padding:1px 0 11px; scrollbar-width:none; }
.pm-filter-row::-webkit-scrollbar { display:none; }
.pm-filter-row button { flex:0 0 auto; height:32px; padding:0 10px; border:1px solid var(--pm-line); border-radius:10px; background:transparent; color:#7e8388; font-size:10.5px; }
.pm-filter-row button.active { color:#d9dadb; border-color:rgba(255,255,255,.17); background:rgba(255,255,255,.035); }
.pm-search { height:44px; display:flex; align-items:center; gap:9px; padding:0 13px; border:1px solid var(--pm-line); border-radius:12px; color:#6f7479; background:#080a0c; margin-bottom:12px; }
.pm-search input,.pm-field input { flex:1; min-width:0; border:0; outline:0; background:transparent; color:var(--pm-text); font-size:14px; }
.pm-company-list,.pm-building-list,.pm-detail-stack,.pm-alert-list { border-top:1px solid var(--pm-line); }
.pm-company-row { display:flex; align-items:center; border-bottom:1px solid var(--pm-line); }
.pm-company-row > a { flex:1; min-width:0; min-height:58px; display:flex; align-items:center; justify-content:space-between; gap:10px; color:inherit; text-decoration:none; padding:10px 3px; }
.pm-company-copy { min-width:0; display:flex; flex-direction:column; gap:4px; }
.pm-company-copy strong,.pm-building-list strong { font-size:14px; font-weight:590; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pm-company-copy small,.pm-building-list small { color:var(--pm-muted); font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pm-check { width:30px; height:30px; margin-right:7px; border:1px solid var(--pm-line); border-radius:9px; background:transparent; color:#fff; display:grid; place-items:center; }
.pm-check.active { background:var(--pm-orange); border-color:var(--pm-orange); color:#111; }
.pm-bulk-bar { position:fixed; z-index:24; left:50%; bottom:calc(82px + env(safe-area-inset-bottom)); transform:translateX(-50%); width:min(calc(100% - 28px), 600px); height:52px; display:flex; align-items:center; justify-content:space-between; gap:10px; padding:0 15px; border:1px solid var(--pm-line); border-radius:15px; background:#151719; box-shadow:0 14px 50px rgba(0,0,0,.4); font-size:12px; }
.pm-bulk-bar a { display:flex; align-items:center; gap:6px; color:var(--pm-orange); text-decoration:none; }
.pm-back { display:inline-flex; align-items:center; gap:3px; color:#8c9196; text-decoration:none; font-size:12px; margin-bottom:18px; }
.pm-record-head { padding-bottom:17px; }
.pm-office { margin-top:12px; display:flex; flex-direction:column; gap:3px; }
.pm-office span,.pm-detail-row > span,.pm-utility span { color:var(--pm-muted); font-size:10.5px; text-transform:uppercase; letter-spacing:.06em; }
.pm-office strong { font-size:12.5px; line-height:1.45; font-weight:520; color:#c5c7c9; }
.pm-tabs { display:flex; gap:18px; overflow-x:auto; border-bottom:1px solid var(--pm-line); margin:0 -16px 14px; padding:0 16px; scrollbar-width:none; }
.pm-tabs::-webkit-scrollbar { display:none; }
.pm-tabs button,.pm-tabs a { height:43px; flex:0 0 auto; display:flex; align-items:center; gap:4px; border:0; border-bottom:2px solid transparent; background:transparent; color:#777c81; text-decoration:none; font-size:11.5px; }
.pm-tabs button.active { color:var(--pm-text); border-bottom-color:var(--pm-orange); }
.pm-tabs span { font-size:10px; color:#666b70; }
.pm-detail-row { min-height:56px; display:flex; align-items:center; justify-content:space-between; gap:14px; border-bottom:1px solid var(--pm-line); }
.pm-detail-row strong { font-size:13px; font-weight:580; }
.pm-followup { display:flex; align-items:center; gap:8px; font-size:12px; }
.pm-followup input { width:31px; height:31px; border:0; background:transparent; color:transparent; color-scheme:dark; }
.pm-detail-link { min-height:64px; display:flex; align-items:center; justify-content:space-between; gap:10px; border-bottom:1px solid var(--pm-line); color:inherit; text-decoration:none; }
.pm-detail-link > span { display:flex; flex-direction:column; gap:4px; }
.pm-detail-link strong { font-size:13px; font-weight:580; }
.pm-detail-link small { color:var(--pm-muted); font-size:11px; }
.pm-contact-row { min-height:68px; display:flex; align-items:center; justify-content:space-between; gap:12px; border-bottom:1px solid var(--pm-line); }
.pm-contact-row > div { display:flex; flex-direction:column; gap:3px; min-width:0; }
.pm-contact-row strong { font-size:13px; font-weight:590; }
.pm-contact-row span,.pm-contact-row a { font-size:10.5px; color:var(--pm-muted); text-decoration:none; }
.pm-note-box { margin-top:14px; border:1px solid var(--pm-line); border-radius:14px; padding:10px; background:#080a0c; }
.pm-note-box textarea,.pm-sheet textarea { width:100%; min-height:86px; resize:vertical; border:0; outline:0; background:transparent; color:var(--pm-text); font:inherit; font-size:13px; }
.pm-note-box button { height:34px; border:0; border-radius:9px; padding:0 12px; background:#1b1e21; color:#d1d2d3; float:right; }
.pm-note-box button:disabled { opacity:.4; }
.pm-timeline { clear:both; padding-top:14px; }
.pm-timeline article { padding:13px 2px; border-bottom:1px solid var(--pm-line); }
.pm-timeline article span { color:var(--pm-muted); font-size:10px; }
.pm-timeline article p { margin:5px 0 0; font-size:12.5px; line-height:1.5; }
.pm-building-list a { min-height:60px; display:flex; align-items:center; justify-content:space-between; gap:10px; border-bottom:1px solid var(--pm-line); color:inherit; text-decoration:none; }
.pm-building-list a > span { min-width:0; display:flex; flex-direction:column; gap:4px; }
.pm-utility { display:grid; grid-template-columns:1fr 1fr; gap:10px; padding:15px 1px; border-bottom:1px solid var(--pm-line); }
.pm-utility > div { display:flex; flex-direction:column; gap:5px; }
.pm-utility strong { font-size:12.5px; font-weight:560; }
.pm-alert-list article { min-height:66px; display:flex; align-items:flex-start; gap:11px; padding:13px 2px; border-bottom:1px solid var(--pm-line); }
.pm-alert-list article > div { display:flex; flex-direction:column; gap:4px; }
.pm-alert-list strong { font-size:12.5px; font-weight:590; }
.pm-alert-list span { color:var(--pm-muted); font-size:10.5px; line-height:1.4; }
.pm-empty { min-height:116px; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; gap:6px; color:#c9cbcc; }
.pm-empty span { color:var(--pm-muted); font-size:11px; }
.pm-engine-state { padding:22px 16px; border:1px solid var(--pm-line); border-radius:15px; background:#080a0c; display:flex; flex-direction:column; gap:9px; }
.pm-engine-state strong { font-size:13px; }
.pm-engine-state p { margin:0; color:var(--pm-muted); font-size:11.5px; line-height:1.55; }
.pm-settings-row { width:100%; min-height:58px; padding:0 3px; border:0; border-bottom:1px solid var(--pm-line); background:transparent; color:inherit; display:flex; align-items:center; gap:12px; text-align:left; }
.pm-settings-row > span { flex:1; display:flex; flex-direction:column; gap:3px; }
.pm-settings-row strong { font-size:13px; font-weight:580; }
.pm-settings-row small { color:var(--pm-muted); font-size:10.5px; }
.pm-settings-row.static { cursor:default; }
.pm-bottom-nav { position:fixed; z-index:25; left:50%; bottom:calc(10px + env(safe-area-inset-bottom)); transform:translateX(-50%); width:min(calc(100% - 28px), 430px); height:58px; display:grid; grid-template-columns:repeat(3,1fr); border:1px solid rgba(255,255,255,.1); border-radius:19px; background:rgba(13,15,17,.92); backdrop-filter:blur(18px); box-shadow:0 12px 44px rgba(0,0,0,.42); }
.pm-bottom-nav a { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; color:#686d72; text-decoration:none; font-size:9.5px; }
.pm-bottom-nav a.active { color:#e5e6e7; }
.pm-drawer-scrim { position:fixed; inset:0; z-index:38; background:rgba(0,0,0,.55); opacity:0; pointer-events:none; transition:opacity .16s ease; }
.pm-drawer-scrim.open { opacity:1; pointer-events:auto; }
.pm-drawer { position:fixed; z-index:40; top:0; bottom:0; left:0; width:min(83vw,340px); transform:translateX(-102%); transition:transform .2s ease; background:#080a0c; border-right:1px solid var(--pm-line); padding:calc(env(safe-area-inset-top) + 13px) 14px calc(env(safe-area-inset-bottom) + 14px); display:flex; flex-direction:column; }
.pm-drawer.open { transform:translateX(0); }
.pm-drawer-head { display:flex; align-items:center; justify-content:space-between; padding:0 1px 14px; border-bottom:1px solid var(--pm-line); }
.pm-drawer-nav { display:flex; flex-direction:column; padding-top:10px; }
.pm-drawer-nav a { min-height:50px; display:flex; align-items:center; gap:12px; color:#b8bbbd; text-decoration:none; border-bottom:1px solid rgba(255,255,255,.035); font-size:13px; }
.pm-profile-row { margin-top:auto; min-height:58px; border:0; border-top:1px solid var(--pm-line); background:transparent; color:inherit; display:flex; align-items:center; gap:12px; text-align:left; }
.pm-profile-row > span { flex:1; display:flex; flex-direction:column; gap:2px; }
.pm-profile-row strong { font-size:12.5px; }
.pm-profile-row small { color:var(--pm-muted); font-size:10.5px; }
.pm-sheet-scrim { position:fixed; inset:0; z-index:60; display:flex; align-items:flex-end; justify-content:center; background:rgba(0,0,0,.62); }
.pm-sheet { width:min(100%,600px); border:1px solid var(--pm-line); border-bottom:0; border-radius:20px 20px 0 0; background:#101214; padding:10px 16px calc(18px + env(safe-area-inset-bottom)); box-shadow:0 -20px 70px rgba(0,0,0,.45); }
.pm-sheet-handle { width:34px; height:4px; border-radius:99px; background:#44484c; margin:0 auto 14px; }
.pm-sheet-head { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; margin-bottom:14px; }
.pm-sheet-head > div { display:flex; flex-direction:column; gap:3px; }
.pm-sheet-head strong { font-size:15px; }
.pm-sheet-head span { color:var(--pm-muted); font-size:10.5px; }
.pm-sheet-head button { width:36px; height:36px; display:grid; place-items:center; border:0; border-radius:10px; background:transparent; color:#aaaeb1; }
.pm-sheet textarea { min-height:116px; border:1px solid var(--pm-line); border-radius:12px; padding:10px; background:#080a0c; }
.pm-sheet-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
.pm-sheet-actions button { height:38px; border:0; border-radius:10px; padding:0 14px; background:#202326; color:#d6d7d8; }
.pm-sheet-actions button.primary { background:#e57a35; color:#141414; font-weight:650; }
.pm-field { display:flex; flex-direction:column; gap:7px; }
.pm-field span { color:var(--pm-muted); font-size:10.5px; }
.pm-field input { height:44px; border:1px solid var(--pm-line); border-radius:12px; padding:0 12px; background:#080a0c; }
.pm-toast { position:fixed; z-index:70; left:50%; bottom:calc(84px + env(safe-area-inset-bottom)); transform:translateX(-50%); min-height:42px; max-width:calc(100% - 32px); display:flex; align-items:center; justify-content:center; padding:0 15px; border:1px solid var(--pm-line); border-radius:13px; background:#17191c; color:#d4d5d6; font-size:11.5px; box-shadow:0 12px 40px rgba(0,0,0,.4); }
.pm-toast.recording { color:var(--pm-orange); }
.pm-toast.error { border-color:rgba(255,115,95,.25); }
.pm-muted { color:var(--pm-muted); }
@media (min-width:720px) { .pm-page { padding-left:22px; padding-right:22px; } }
`;
