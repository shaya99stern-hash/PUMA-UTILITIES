'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, Search } from 'lucide-react';
import type { ResearchRunResult } from '@/lib/research/runner';
import { assessResearchRun } from '@/lib/research/qualification';
import { rankDecisionMakers } from '@/lib/research/decision-maker';
import { estimatePropertyWaterCost } from '@/lib/research/water-cost';
import { buildOpportunityIntelligence } from '@/lib/research/opportunity';
import { rankPropertyOpportunities } from '@/lib/research/property-priority';
import { parseTariffClassEvidence } from '@/lib/research/tariff-class';
import { parseTariffMetadata, tariffFreshness } from '@/lib/research/tariff-metadata';
import type { ResearchMergeSummary } from '@/lib/research/workspace-projection';

type Candidate = { name: string; website: string; snippet?: string; sourceUrl: string; confidence: number; score: number; hits: number; markets: string[]; reasons: string[] };
type DiscoveryDiagnostics = { attempted: number; succeeded: number; failed: number; backends: string[] };
type Capability = {
  webDiscoveryConfigured: boolean;
  webDiscoveryBackend?: 'searxng' | 'duckduckgo-html';
  browserEnrichmentConfigured: boolean;
  officialLeadershipSources?: string[];
  officialPropertySources?: string[];
  structuredFirstParty?: string[];
  costEstimation?: string;
};
type ResearchJobPayload = { runId?: string; status?: string; result?: ResearchRunResult | null; error?: string };
type Props = { onSave: (result: ResearchRunResult) => ResearchMergeSummary };

const ACTIVE_RUN_KEY = 'puma-active-research-run';
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export default function PumaResearchPanel({ onSave }: Props) {
  const [capability, setCapability] = useState<Capability | null>(null);
  const [geography, setGeography] = useState('NJ');
  const [markets, setMarkets] = useState('NJ, NY, PA');
  const [minBuildings, setMinBuildings] = useState(20);
  const [maxBuildings, setMaxBuildings] = useState(100);
  const [company, setCompany] = useState('');
  const [website, setWebsite] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [result, setResult] = useState<ResearchRunResult | null>(null);
  const [status, setStatus] = useState<'idle'|'discovering'|'researching'|'saved'>('idle');
  const [error, setError] = useState('');
  const [hasDiscovered, setHasDiscovered] = useState(false);
  const [discoveryWarnings, setDiscoveryWarnings] = useState<string[]>([]);
  const [discoveryDiagnostics, setDiscoveryDiagnostics] = useState<DiscoveryDiagnostics | null>(null);
  const [saveSummary, setSaveSummary] = useState<ResearchMergeSummary | null>(null);

  useEffect(() => {
    fetch('/api/research/run', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Capability check failed.')))
      .then(setCapability)
      .catch(() => setCapability({ webDiscoveryConfigured: false, browserEnrichmentConfigured: false }));
  }, []);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const savedCompany = searchParams.get('company')?.trim();
    const savedState = searchParams.get('state')?.trim().toUpperCase();
    const savedWebsite = searchParams.get('website')?.trim();
    if (savedCompany) setCompany(savedCompany);
    if (savedState && /^[A-Z]{2}$/.test(savedState)) setGeography(savedState);
    if (savedWebsite) setWebsite(savedWebsite);

    const activeRunId = window.localStorage.getItem(ACTIVE_RUN_KEY);
    if (activeRunId) void resumeResearchJob(activeRunId);
  }, []);

  const assessment = useMemo(() => result ? assessResearchRun(result) : null, [result]);
  const opportunity = useMemo(() => result ? buildOpportunityIntelligence(result) : null, [result]);
  const topProperties = useMemo(() => result ? rankPropertyOpportunities(result.graph, result.rootEntityId).slice(0, 8) : [], [result]);
  const root = result?.graph.entities.find((entity) => entity.id === result.rootEntityId);
  const decisionMakers = useMemo(() => result ? rankDecisionMakers(result.graph, result.rootEntityId) : [], [result]);
  const properties = result?.graph.entities.filter((entity) => entity.kind === 'property') ?? [];
  const utilities = result?.graph.entities.filter((entity) => entity.kind === 'utility') ?? [];
  const officialOwnershipProperties = useMemo(() => result
    ? new Set(result.graph.claims
        .filter((claim) => claim.fact === 'property.owner' && (claim.state === 'VERIFIED' || claim.state === 'SUPPORTED'))
        .filter((claim) => claim.evidenceIds.some((id) => result.graph.evidence.find((evidence) => evidence.id === id)?.authority === 'official'))
        .map((claim) => claim.subjectId)).size
    : 0, [result]);
  const waterEstimates = useMemo(() => result
    ? result.graph.entities
        .filter((entity) => entity.kind === 'property')
        .map((entity) => estimatePropertyWaterCost(result.graph, entity.id))
        .filter((value): value is NonNullable<typeof value> => Boolean(value))
    : [], [result]);

  const discover = async () => {
    setStatus('discovering'); setError(''); setResult(null); setHasDiscovered(false); setSaveSummary(null); setDiscoveryWarnings([]); setDiscoveryDiagnostics(null);
    try {
      const response = await fetch('/api/research/discover', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ geography: markets, minBuildings, maxBuildings, count:10 }) });
      const payload = await response.json() as { candidates?: Candidate[]; warnings?: string[]; diagnostics?: DiscoveryDiagnostics; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Discovery failed.');
      setCandidates(payload.candidates ?? []); setDiscoveryWarnings(payload.warnings ?? []); setDiscoveryDiagnostics(payload.diagnostics ?? null); setHasDiscovered(true); setStatus('idle');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setStatus('idle'); }
  };

  const deepResearch = async (name = company, url = website, targetGeography = geography) => {
    const label = name.trim(); if (!label) return;
    setCompany(label); setWebsite(url); setGeography(targetGeography); setStatus('researching'); setError(''); setResult(null); setSaveSummary(null);
    try {
      const response = await fetch('/api/research/jobs', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ label, geography:targetGeography, website:url || undefined, maxTasks:60, maxBudgetUnits:82, maxDepth:4, perNeed:6 }) });
      const payload = await response.json() as ResearchJobPayload;
      if (!response.ok || !payload.runId) throw new Error(payload.error || 'Research job could not be created.');
      window.localStorage.setItem(ACTIVE_RUN_KEY, payload.runId);
      await pumpResearchJob(payload.runId);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setStatus('idle'); }
  };

  async function resumeResearchJob(runId: string) {
    setStatus('researching'); setError(''); setSaveSummary(null);
    try {
      const response = await fetch(`/api/research/jobs/${encodeURIComponent(runId)}`, { cache: 'no-store' });
      const payload = await response.json() as ResearchJobPayload;
      if (!response.ok) throw new Error(payload.error || 'Saved research could not be resumed.');
      if (TERMINAL_JOB_STATUSES.has(payload.status ?? '')) {
        window.localStorage.removeItem(ACTIVE_RUN_KEY);
        if (payload.result) setResult(payload.result);
        setStatus('idle');
        if (!payload.result && payload.status === 'failed') setError('The saved research run ended without a usable dossier.');
        return;
      }
      await pumpResearchJob(runId);
    } catch (cause) {
      setStatus('idle');
      setError(cause instanceof Error ? cause.message : 'Saved research could not be resumed.');
    }
  }

  async function pumpResearchJob(runId: string) {
    for (let step = 0; step < 90; step += 1) {
      const response = await fetch(`/api/research/jobs/${encodeURIComponent(runId)}/pump`, { method:'POST', cache:'no-store' });
      const payload = await response.json() as ResearchJobPayload;
      if (!response.ok) throw new Error(payload.error || 'Research worker stopped unexpectedly.');
      if (TERMINAL_JOB_STATUSES.has(payload.status ?? '')) {
        window.localStorage.removeItem(ACTIVE_RUN_KEY);
        if (payload.result) {
          setResult(payload.result);
          setError('');
        } else if (payload.status === 'failed') {
          setError('Research ended without a usable dossier.');
        }
        setStatus('idle');
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 750));
    }
    setStatus('idle');
    setError('Research progress is saved. Reopen Engine to continue this run.');
  }

  const save = () => {
    if (!result) return;
    try {
      const summary = onSave(result);
      setSaveSummary(summary);
      setStatus('saved');
      setError('');
    } catch (cause) {
      setStatus('idle');
      setError(cause instanceof Error ? cause.message : 'Could not save this research result.');
    }
  };

  return (
    <div className="pm-research">
      <section className="pm-research-card pm-research-discover">
        <div className="pm-research-title"><strong>Find real companies</strong><span>Search public sources for owner/operators, then verify the strongest results before anything is saved.</span></div>
        <label className="pm-research-field"><span>Markets</span><input value={markets} maxLength={24} onChange={(e) => setMarkets(e.target.value.toUpperCase())} placeholder="NJ, NY, PA" /></label>
        <details className="pm-research-advanced"><summary>Advanced filters</summary><div className="pm-research-grid"><label><span>Min buildings</span><input type="number" value={minBuildings} onChange={(e) => setMinBuildings(Number(e.target.value))} /></label><label><span>Max buildings</span><input type="number" value={maxBuildings} onChange={(e) => setMaxBuildings(Number(e.target.value))} /></label></div></details>
        <button className="pm-research-primary" type="button" disabled={status === 'discovering' || !capability?.webDiscoveryConfigured} onClick={() => void discover()}><Search size={16} /> {status === 'discovering' ? 'Searching public sources…' : 'Find real companies'}</button>
      </section>

      {discoveryWarnings.length > 0 && <div className="pm-research-error" role="status"><strong>Partial discovery</strong><span>{discoveryDiagnostics?.succeeded ?? 0} of {discoveryDiagnostics?.attempted ?? 0} searches completed. Results below come only from successful searches.</span></div>}
      {hasDiscovered && candidates.length === 0 && <div className="pm-research-empty"><strong>No strong candidates found.</strong><span>Try broader markets or loosen the advanced portfolio range. Puma will not fill the list with weak pseudo-leads.</span></div>}
      {candidates.length > 0 && <section className="pm-research-list pm-research-candidates">{candidates.map((candidate) => <article key={candidate.website}><div><strong>{candidate.name}</strong><span>{candidate.markets.join(', ')} · Discovery {candidate.score}/100 · {candidate.hits} signal{candidate.hits === 1 ? '' : 's'}</span><span>{candidate.reasons.slice(0,2).join(' · ') || candidate.snippet || candidate.website}</span><a href={candidate.sourceUrl} target="_blank" rel="noreferrer">Discovery source <ExternalLink size={11} /></a></div><button type="button" onClick={() => void deepResearch(candidate.name, candidate.website, candidate.markets[0] ?? geography)}>Research</button></article>)}</section>}

      <section className="pm-research-card pm-research-deep">
        <div className="pm-research-title"><strong>Research one company</strong><span>Enter a company and state. Puma can resolve the website, leadership, portfolio, utilities, rates, and evidence itself.</span></div>
        <label className="pm-research-field"><span>Company</span><input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company name" /></label>
        <label className="pm-research-field"><span>State</span><input value={geography} maxLength={2} onChange={(e) => setGeography(e.target.value.toUpperCase())} placeholder="NJ" /></label>
        <details className="pm-research-advanced"><summary>Advanced</summary><label className="pm-research-field"><span>Website hint</span><input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Optional" /></label></details>
        <button className="pm-research-primary" type="button" disabled={!company.trim() || status === 'researching'} onClick={() => void deepResearch()}><Search size={16} /> {status === 'researching' ? 'Researching… progress is saved' : 'Research company'}</button>
      </section>

      {error && <div className="pm-research-error">{error}</div>}
      {result && <section className="pm-research-result">
        <div className="pm-research-result-head"><div><span>Research dossier</span><h2>{root?.label}</h2><p>{Math.round(result.rootCompleteness * 100)}% core completeness · {result.tasksExecuted} tasks · {result.budgetUnitsSpent ?? 0}/{result.maxBudgetUnits ?? '—'} effort units · {result.blocked} blocked · {result.failed} failed · stopped: {result.stopReason}</p></div>{assessment && <div className="pm-research-scores"><div><strong>{assessment.fit}</strong><span>Fit</span></div><div><strong>{assessment.actionability}</strong><span>Actionability</span></div></div>}</div>
        <div className="pm-research-facts"><div><span>Decision-makers</span><strong>{decisionMakers.length}</strong></div><div><span>Properties found</span><strong>{properties.length}</strong></div><div><span>Utilities found</span><strong>{utilities.length}</strong></div><div><span>Official owners</span><strong>{officialOwnershipProperties}</strong></div><div><span>Evidence items</span><strong>{result.graph.evidence.length}</strong></div></div>

        {opportunity && <div className="pm-research-section pm-opportunity-intelligence"><span>Opportunity intelligence</span><div><strong>Priority</strong><small>{opportunity.priority}/100 · {opportunity.confidence} confidence</small></div><div><strong>Portfolio coverage</strong><small>{opportunity.linkedProperties} linked · {opportunity.officialOwnershipProperties} official owners · {opportunity.utilityResolvedProperties} utilities · {opportunity.rateResolvedProperties} rates</small></div><div><strong>Water benchmark</strong><small>{opportunity.annualWaterSpendBenchmark ? `~$${opportunity.annualWaterSpendBenchmark.toLocaleString()}/yr across ${opportunity.benchmarkedProperties} benchmarked propert${opportunity.benchmarkedProperties === 1 ? 'y' : 'ies'}` : 'Not enough sourced residential + active tariff evidence yet'}</small></div>{opportunity.topContact && <div><strong>Top contact</strong><small>{opportunity.topContact.name}{opportunity.topContact.title ? ` · ${opportunity.topContact.title}` : ''} · {opportunity.topContact.score}/100</small></div>}{opportunity.nextActions.slice(0,3).map((action,index) => <div key={`action-${index}`}><strong>{index === 0 ? 'Next best action' : `Then #${index + 1}`}</strong><small>{action}</small></div>)}{opportunity.gaps.length > 0 && <details><summary>Unresolved gaps ({opportunity.gaps.length})</summary>{opportunity.gaps.map((gap) => <p key={gap}>{gap}</p>)}</details>}</div>}

        {topProperties.length > 0 && <div className="pm-research-section"><span>Top buildings to investigate</span>{topProperties.map((property) => <div key={property.propertyId ?? property.propertyName}><strong>{property.propertyName}</strong><small>{[`Priority ${property.score}/100`,property.provider,property.annualWaterSpendBenchmark ? `~$${Math.round(property.annualWaterSpendBenchmark).toLocaleString()}/yr` : undefined,property.gaps[0]].filter(Boolean).join(' · ')}</small></div>)}</div>}
        {decisionMakers.length > 0 && <div className="pm-research-section"><span>People to reach — ranked</span>{decisionMakers.slice(0,10).map((person) => <div key={person.personId}><strong>{person.name}</strong><small>{[`Priority ${person.score}/100`,person.title || 'Role needs verification',person.email,person.phone,person.contactStatus === 'company-only' ? 'route via company office' : undefined].filter(Boolean).join(' · ')}</small></div>)}</div>}
        {properties.length > 0 && <div className="pm-research-section"><span>Properties</span>{properties.slice(0,12).map((property) => { const units=result.graph.claims.find((claim) => claim.subjectId===property.id && claim.fact==='property.units' && (claim.state==='VERIFIED'||claim.state==='SUPPORTED'))?.value; const area=result.graph.claims.find((claim) => claim.subjectId===property.id && claim.fact==='property.grossSquareFeet' && (claim.state==='VERIFIED'||claim.state==='SUPPORTED'))?.value; const estimate=waterEstimates.find((item) => item.propertyId===property.id); return <div key={property.id}><strong>{property.label}</strong><small>{[property.geography||'State unresolved',typeof units==='number'?`${units.toLocaleString()} units`:undefined,typeof area==='number'?`${area.toLocaleString()} sq ft`:undefined,estimate?`~$${Math.round(estimate.annualEstimatedWaterCost).toLocaleString()}/yr water benchmark${estimate.includesFixedCharges?' incl. fixed water charge':''}`:undefined].filter(Boolean).join(' · ')}</small></div>; })}</div>}
        {waterEstimates.length > 0 && <div className="pm-research-section"><span>Defensible water-cost benchmarks</span>{waterEstimates.slice(0,12).map((estimate) => <div key={estimate.propertyId}><strong>{result.graph.entities.find((entity) => entity.id===estimate.propertyId)?.label ?? estimate.provider}</strong><small>{`~$${Math.round(estimate.annualEstimatedWaterCost).toLocaleString()}/yr water · $${Math.round(estimate.monthlyEstimatedWaterCost).toLocaleString()}/mo · ${estimate.includesFixedCharges?'published fixed water charge included · ':''}sewer/tax/demand excluded`}</small></div>)}</div>}
        {utilities.length > 0 && <div className="pm-research-section"><span>Water providers</span>{utilities.slice(0,12).map((utility) => { const ami=result.graph.claims.find((claim) => claim.subjectId===utility.id && claim.fact==='utility.amiCapability' && (claim.state==='VERIFIED'||claim.state==='SUPPORTED'))?.value?.toString(); const rate=result.graph.claims.find((claim) => claim.subjectId===utility.id && claim.fact==='utility.rateSchedule' && (claim.state==='VERIFIED'||claim.state==='SUPPORTED'))?.value?.toString(); const tariffClass=rate?parseTariffClassEvidence(rate):undefined; const metadata=rate?parseTariffMetadata(rate):undefined; const freshness=metadata?tariffFreshness(metadata):undefined; return <div key={utility.id}><strong>{utility.label}</strong><small>{[utility.geography||'Service area evidence',ami?'AMI evidence found':'AMI unknown',rate?'Rate evidence found':'Rate unresolved',tariffClass?`Class: ${tariffClass}`:undefined,freshness?`Tariff: ${freshness}`:undefined].filter(Boolean).join(' · ')}</small></div>; })}</div>}

        <details className="pm-research-evidence"><summary>Evidence <span>{result.graph.evidence.length}</span></summary><div className="pm-research-evidence-list">{result.graph.evidence.slice(0,12).map((evidence) => <a key={evidence.id} href={evidence.url} target="_blank" rel="noreferrer"><strong>{evidence.sourceId}</strong><small>{evidence.excerpt || evidence.url}</small><ExternalLink size={12} /></a>)}</div></details>
        <button className="pm-research-save" type="button" onClick={save}>{status === 'saved' ? <><CheckCircle2 size={16} /> Saved to Prospects</> : 'Save to Prospects'}</button>
        {saveSummary && <div className="pm-research-section pm-research-save-summary" role="status"><span>{saveSummary.createdCompany ? 'Prospect created' : 'Prospect updated'}</span><div><strong>Saved to Puma CRM</strong><small>{saveSummary.peopleAdded} contacts · {saveSummary.propertiesAdded} buildings · {saveSummary.utilitiesAdded} utilities · {saveSummary.parcelsAdded} parcels · {saveSummary.tariffsAdded} tariffs added</small></div><Link href={`/clients/${encodeURIComponent(saveSummary.companyId)}`}>Open company</Link></div>}
        <p className="pm-research-capability">Water-cost estimates appear only when Puma has sourced residential unit evidence plus one unambiguous published variable water rate; sourced gross floor area can refine the multifamily benchmark range. Explicitly expired or future tariff periods are excluded. One unambiguous published water service charge may be normalized to a monthly amount and included. Sewer, wastewater, tax, demand, meter-size-dependent and unresolved tiered charges remain excluded. Customer-class labels are displayed only when explicitly published; Puma does not infer the applicable tariff class.</p>
      </section>}
    </div>
  );
}
