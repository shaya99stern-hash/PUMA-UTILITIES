'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Building2, MapPin, Search, Sparkles } from 'lucide-react';
import { apiPost, useApi } from '@/lib/client/api';
import { Badge, Button, Card, Chip, EmptyState, Field, Input, PageHeader, ProgressBar, Select, Skeleton, formatRelative, useToast } from '@/app/ui';
import './leads.css';

type JobListItem = { id: string; kind: string; title: string; status: string; progress: number; stage: string | null; candidates: number; saved: number; created_at: string; stats: Record<string, number> };

const STATES = ['NJ', 'NY', 'PA'];
const OWNER_TYPES = [
  { value: 'any', label: 'Any owner or manager' },
  { value: 'property_manager', label: 'Property management companies' },
  { value: 'owner_operator', label: 'Owner-operators' },
  { value: 'public_housing', label: 'Housing authorities' },
  { value: 'nonprofit', label: 'Nonprofit / affordable' },
];

function splitList(value: string) {
  return value.split(/[,;\n]+/).map((v) => v.trim()).filter(Boolean);
}

export default function FindLeadsPage() {
  const router = useRouter();
  const toast = useToast();
  const jobs = useApi<{ jobs: JobListItem[] }>('/api/research/jobs?limit=20', { refreshInterval: 5000 });
  const [states, setStates] = useState<string[]>(['NJ', 'NY', 'PA']);
  const [otherStates, setOtherStates] = useState('');
  const [where, setWhere] = useState('');
  const [zips, setZips] = useState('');
  const [minUnits, setMinUnits] = useState('100');
  const [minBuildingUnits, setMinBuildingUnits] = useState('10');
  const [ownerType, setOwnerType] = useState('any');
  const [keywords, setKeywords] = useState('');
  const [limit, setLimit] = useState('40');
  const [starting, setStarting] = useState(false);

  const toggle = (s: string) => setStates((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const start = async () => {
    const allStates = [...new Set([...states, ...splitList(otherStates).map((s) => s.toUpperCase())])].filter((s) => /^[A-Z]{2}$/.test(s));
    if (!allStates.length) {
      toast.error('Pick at least one state');
      return;
    }
    const places = splitList(where);
    setStarting(true);
    try {
      const res = await apiPost<{ id: string }>('/api/research/jobs', {
        states: allStates,
        counties: places.filter((p) => /county$/i.test(p) || /^(kings|queens|bronx|richmond|new york|bergen|hudson|essex|union|passaic|middlesex|monmouth|morris|camden|mercer|montgomery|bucks|delaware|chester|philadelphia|allegheny)$/i.test(p)),
        cities: places.filter((p) => !/county$/i.test(p)),
        zips: splitList(zips),
        minUnits: Number(minUnits) || 0,
        minBuildingUnits: Number(minBuildingUnits) || 5,
        ownerType,
        keywords: splitList(keywords),
        limit: Number(limit) || 40,
      });
      router.push(`/leads/${res.id}`);
    } catch (e) {
      toast.error('Could not start the search', (e as Error).message);
      setStarting(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Find leads" subtitle="Multifamily owners and managers, cross-referenced across public records, websites and registries — with decision makers, contact routes and water spend." />

      <Card className="leads-builder" title="New search" description="Free public sources: NYC PLUTO / HPD / LL84 / liens, NJ MOD-IV (statewide), Philadelphia OPA, Montgomery County, HUD (nationwide), NY DOS, EPA water systems, company websites, ContactOut and your connectors.">
        <div className="stack">
          <Field label="States">
            <div className="row-wrap">
              {STATES.map((s) => (
                <Chip key={s} selected={states.includes(s)} onClick={() => toggle(s)}>{s}</Chip>
              ))}
              <Input className="leads-other" placeholder="Other states (CT, MA…) — HUD + connectors" value={otherStates} onChange={(e) => setOtherStates(e.target.value)} />
            </div>
          </Field>
          <div className="grid-2">
            <Field label="Counties, boroughs or cities" hint="e.g. Hudson County, Brooklyn, Newark, Philadelphia. Leave blank for all.">
              <Input leading={<MapPin size={16} />} value={where} onChange={(e) => setWhere(e.target.value)} placeholder="Hudson County, Brooklyn" />
            </Field>
            <Field label="ZIP codes" hint="Optional, comma separated.">
              <Input value={zips} onChange={(e) => setZips(e.target.value)} placeholder="07302, 11211" inputMode="numeric" />
            </Field>
          </div>
          <div className="grid-3">
            <Field label="Minimum portfolio units">
              <Input value={minUnits} onChange={(e) => setMinUnits(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
            </Field>
            <Field label="Minimum units per building">
              <Input value={minBuildingUnits} onChange={(e) => setMinBuildingUnits(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
            </Field>
            <Field label="How many leads">
              <Select value={limit} onChange={(e) => setLimit(e.target.value)} options={['20', '40', '75', '120', '200']} />
            </Field>
          </div>
          <div className="grid-2">
            <Field label="Owner type">
              <Select value={ownerType} onChange={(e) => setOwnerType(e.target.value)} options={OWNER_TYPES} />
            </Field>
            <Field label="Keywords" hint="Optional: match company names (e.g. management, realty).">
              <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="management" />
            </Field>
          </div>
          <div className="row-between">
            <span className="subtle text-sm">Research keeps running in the background — you can leave this page.</span>
            <Button variant="primary" icon={Search} loading={starting} onClick={start}>Find leads</Button>
          </div>
        </div>
      </Card>

      <section className="stack">
        <h2 className="section-title">Recent searches</h2>
        {jobs.isLoading && !jobs.data ? (
          <Skeleton height={72} />
        ) : !jobs.data?.jobs.length ? (
          <EmptyState icon={Sparkles} title="No searches yet" description="Start a search above. Puma pulls buildings, links them into portfolios, then researches the decision makers behind each one." bordered />
        ) : (
          <div className="leads-jobs">
            {jobs.data.jobs.map((j) => (
              <Card key={j.id} href={`/leads/${j.id}`} className="leads-job">
                <div className="row-between">
                  <div className="stack-sm grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 8 }}>
                      {j.kind === 'enrich' ? <Building2 size={16} /> : <Search size={16} />}
                      <strong className="truncate">{j.title}</strong>
                    </div>
                    <span className="subtle text-sm">{formatRelative(j.created_at)} · {j.stage ?? j.status}{j.candidates ? ` · ${j.candidates} leads` : ''}{j.saved ? ` · ${j.saved} saved` : ''}</span>
                  </div>
                  <div className="row" style={{ gap: 10 }}>
                    <Badge tone={j.status === 'completed' ? 'success' : j.status === 'failed' ? 'danger' : j.status === 'canceled' ? 'neutral' : 'info'} dot>{j.status}</Badge>
                    <ArrowRight size={16} className="subtle" />
                  </div>
                </div>
                {(j.status === 'running' || j.status === 'queued') && <ProgressBar value={j.progress} tone="accent" size="sm" className="leads-job-progress" />}
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
