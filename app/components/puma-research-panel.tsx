'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, Search } from 'lucide-react';
import type { ResearchRunResult } from '@/lib/research/runner';
import type { ResearchEntity } from '@/lib/research/types';
import { assessResearchRun } from '@/lib/research/qualification';
import type { ResearchMergeSummary } from '@/lib/research/workspace-projection';

type Candidate = { name: string; website: string; snippet?: string; sourceUrl: string; confidence: number };
type Capability = { webDiscoveryConfigured: boolean; browserEnrichmentConfigured: boolean };
type Props = { onSave: (result: ResearchRunResult) => ResearchMergeSummary };

export default function PumaResearchPanel({ onSave }: Props) {
  const [capability, setCapability] = useState<Capability | null>(null);
  const [geography, setGeography] = useState('NJ');
  const [minBuildings, setMinBuildings] = useState(20);
  const [maxBuildings, setMaxBuildings] = useState(100);
  const [company, setCompany] = useState('');
  const [website, setWebsite] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [result, setResult] = useState<ResearchRunResult | null>(null);
  const [status, setStatus] = useState<'idle'|'discovering'|'researching'|'saved'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/research/run', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Capability check failed.')))
      .then(setCapability)
      .catch(() => setCapability({ webDiscoveryConfigured: false, browserEnrichmentConfigured: false }));
  }, []);

  const assessment = useMemo(() => result ? assessResearchRun(result) : null, [result]);
  const root = result?.graph.entities.find((entity) => entity.id === result.rootEntityId);
  const decisionMakerClaims = result?.graph.claims.filter((claim) =>
    claim.subjectId === result.rootEntityId &&
    claim.fact === 'person.decisionMaker' &&
    claim.objectEntityId &&
    (claim.state === 'VERIFIED' || claim.state === 'SUPPORTED')
  ) ?? [];
  const decisionMakers = decisionMakerClaims
    .map((claim) => result?.graph.entities.find((entity) => entity.id === claim.objectEntityId))
    .filter((value): value is ResearchEntity => Boolean(value));
  const properties = result?.graph.entities.filter((entity) => entity.kind === 'property') ?? [];
  const utilities = result?.graph.entities.filter((entity) => entity.kind === 'utility') ?? [];

  const discover = async () => {
    setStatus('discovering');
    setError('');
    setResult(null);
    try {
      const response = await fetch('/api/research/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geography, minBuildings, maxBuildings, count: 10 }),
      });
      const payload = await response.json() as { candidates?: Candidate[]; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Discovery failed.');
      setCandidates(payload.candidates ?? []);
      setStatus('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('idle');
    }
  };

  const deepResearch = async (name = company, url = website) => {
    const label = name.trim();
    if (!label) return;
    setCompany(label);
    setWebsite(url);
    setStatus('researching');
    setError('');
    setResult(null);
    try {
      const response = await fetch('/api/research/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, geography, website: url || undefined, maxTasks: 36, maxDepth: 3, concurrency: 4, perNeed: 4 }),
      });
      const payload = await response.json() as ResearchRunResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Research failed.');
      setResult(payload);
      setStatus('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('idle');
    }
  };

  const save = () => {
    if (!result) return;
    onSave(result);
    setStatus('saved');
  };

  return (
    <div className="pm-research">
      <section className="pm-research-card">
        <div className="pm-research-title">
          <strong>Discover owner/operators</strong>
          <span>Start broad, then deeply verify only the strongest candidates.</span>
        </div>
        <div className="pm-research-grid">
          <label><span>State</span><input value={geography} maxLength={2} onChange={(e) => setGeography(e.target.value.toUpperCase())} /></label>
          <label><span>Min buildings</span><input type="number" value={minBuildings} onChange={(e) => setMinBuildings(Number(e.target.value))} /></label>
          <label><span>Max buildings</span><input type="number" value={maxBuildings} onChange={(e) => setMaxBuildings(Number(e.target.value))} /></label>
        </div>
        <button className="pm-research-primary" type="button" disabled={status === 'discovering' || !capability?.webDiscoveryConfigured} onClick={() => void discover()}>
          <Search size={16} /> {status === 'discovering' ? 'Finding candidates…' : 'Find 10 candidates'}
        </button>
        {capability && <p className="pm-research-capability">
          Web discovery: {capability.webDiscoveryConfigured ? 'connected' : 'not configured'} · Browser/ContactOut enrichment: {capability.browserEnrichmentConfigured ? 'connected' : 'optional worker not configured'}
        </p>}
      </section>

      {candidates.length > 0 && <section className="pm-research-list">
        {candidates.map((candidate) => <article key={candidate.website}>
          <div>
            <strong>{candidate.name}</strong>
            <span>{candidate.snippet || candidate.website}</span>
            <a href={candidate.sourceUrl} target="_blank" rel="noreferrer">Discovery source <ExternalLink size={11} /></a>
          </div>
          <button type="button" onClick={() => void deepResearch(candidate.name, candidate.website)}>Research</button>
        </article>)}
      </section>}

      <section className="pm-research-card">
        <div className="pm-research-title">
          <strong>Deep research a company</strong>
          <span>Cross-reference leadership, public business contacts, properties, water utilities, AMI/smart-meter evidence, and source conflicts.</span>
        </div>
        <label className="pm-research-field"><span>Company</span><input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Denholtz Properties" /></label>
        <label className="pm-research-field"><span>Known website (optional)</span><input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" /></label>
        <button className="pm-research-primary" type="button" disabled={!company.trim() || status === 'researching'} onClick={() => void deepResearch()}>
          <Search size={16} /> {status === 'researching' ? 'Researching…' : 'Run deep research'}
        </button>
      </section>

      {error && <div className="pm-research-error">{error}</div>}

      {result && <section className="pm-research-result">
        <div className="pm-research-result-head">
          <div>
            <span>Research dossier</span>
            <h2>{root?.label}</h2>
            <p>{Math.round(result.rootCompleteness * 100)}% core completeness · {result.tasksExecuted} tasks · {result.blocked} blocked · {result.failed} failed</p>
          </div>
          {assessment && <div className="pm-research-scores">
            <div><strong>{assessment.fit}</strong><span>Fit</span></div>
            <div><strong>{assessment.actionability}</strong><span>Actionability</span></div>
          </div>}
        </div>

        <div className="pm-research-facts">
          <div><span>Decision-makers</span><strong>{decisionMakers.length}</strong></div>
          <div><span>Properties found</span><strong>{properties.length}</strong></div>
          <div><span>Utilities found</span><strong>{utilities.length}</strong></div>
          <div><span>Evidence items</span><strong>{result.graph.evidence.length}</strong></div>
        </div>

        {decisionMakers.length > 0 && <div className="pm-research-section">
          <span>People to reach</span>
          {decisionMakers.map((person) => <div key={person.id}>
            <strong>{person.label}</strong>
            <small>{result.graph.claims.find((claim) =>
              claim.subjectId === person.id &&
              claim.fact === 'person.title' &&
              (claim.state === 'VERIFIED' || claim.state === 'SUPPORTED')
            )?.value?.toString() || 'Role needs verification'}</small>
          </div>)}
        </div>}

        {properties.length > 0 && <div className="pm-research-section">
          <span>Properties</span>
          {properties.slice(0, 12).map((property) => <div key={property.id}><strong>{property.label}</strong><small>{property.geography || 'State unresolved'}</small></div>)}
        </div>}

        {utilities.length > 0 && <div className="pm-research-section">
          <span>Water providers</span>
          {utilities.slice(0, 12).map((utility) => <div key={utility.id}><strong>{utility.label}</strong><small>{utility.geography || 'Service area evidence'}</small></div>)}
        </div>}

        <div className="pm-research-evidence">
          <span>Evidence</span>
          {result.graph.evidence.slice(0, 12).map((evidence) => <a key={evidence.id} href={evidence.url} target="_blank" rel="noreferrer">
            <strong>{evidence.sourceId}</strong>
            <small>{evidence.excerpt || evidence.url}</small>
            <ExternalLink size={12} />
          </a>)}
        </div>

        <button className="pm-research-save" type="button" onClick={save}>
          {status === 'saved' ? <><CheckCircle2 size={16} /> Saved to Prospects</> : 'Save to Prospects'}
        </button>
        <p className="pm-research-capability">Water-bill estimation is intentionally withheld until Puma has a current rate schedule plus a defensible usage or unit-count proxy. Provider and AMI evidence can still be saved now.</p>
      </section>}
    </div>
  );
}
