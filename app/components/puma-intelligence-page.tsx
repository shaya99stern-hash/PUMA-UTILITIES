'use client';

import Link from 'next/link';
import { Download, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { workspaceProspectsCsv } from '@/lib/export-prospects';
import { rankWorkspacePropertyOpportunities } from '@/lib/research/property-priority';
import { companyResearchRecency } from '@/lib/research/research-snapshot';
import { stripLegacyReleaseOneSeeds } from '@/lib/seed';
import type { Workspace } from '@/lib/types';
import { loadWorkspace } from '@/lib/workspace';

export default function PumaIntelligencePage() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  useEffect(() => { setWorkspace(stripLegacyReleaseOneSeeds(loadWorkspace())); }, []);

  const companies = useMemo(() => workspace ? [...workspace.companies].sort((a,b) => (b.opportunityIntelligence?.priority ?? -1) - (a.opportunityIntelligence?.priority ?? -1) || a.name.localeCompare(b.name)) : [], [workspace]);

  const downloadCsv = () => {
    if (!workspace || workspace.companies.length === 0) return;
    const blob = new Blob([workspaceProspectsCsv(workspace)], { type:'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `puma-prospects-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  if (!workspace) return <main className="pm-shell"><div className="pm-loading">Loading intelligence…</div></main>;

  return (
    <main className="pm-recovery" style={{ placeItems:'start center' }}>
      <section className="pm-recovery-card" style={{ width:'min(100%, 980px)' }}>
        <div className="pm-page-head">
          <div><h1>Prospect Intelligence</h1><p>Evidence-backed priority, research recency, and building-level opportunity.</p></div>
          <button className="pm-text-button" type="button" onClick={downloadCsv} disabled={companies.length === 0}><Download size={16} /> Export CSV</button>
        </div>
        <div className="pm-recovery-actions" style={{ marginBottom:18 }}><Link href="/clients">Companies</Link><Link href="/engine"><Search size={15} /> Find Leads</Link></div>
        {companies.length === 0 && <div className="pm-empty"><strong>No researched prospects yet.</strong><span>Research and save a real company first.</span></div>}
        {companies.map((company) => {
          const recency = companyResearchRecency(workspace, company.id);
          const buildings = rankWorkspacePropertyOpportunities(workspace, company.id).slice(0,5);
          const intelligence = company.opportunityIntelligence;
          return <article key={company.id} className="pm-home-panel" style={{ marginBottom:14 }}>
            <div className="pm-home-panel-head"><div><span>{company.market || 'Market unresolved'} · {company.stage}</span><strong>{company.name}</strong></div><Link href={`/clients/${encodeURIComponent(company.id)}`}>Open company</Link></div>
            <div className="pm-detail-stack" style={{ border:0, borderRadius:0 }}>
              <div className="pm-detail-row"><span>Priority</span><strong>{intelligence ? `${intelligence.priority}/100 · ${intelligence.confidence}` : 'Not scored yet'}</strong></div>
              <div className="pm-detail-row"><span>Research recency</span><strong>{recency.status}{recency.latestRetrievedAt ? ` · ${new Date(recency.latestRetrievedAt).toLocaleDateString()}` : ''}</strong></div>
              <div className="pm-detail-row"><span>Coverage</span><strong>{intelligence ? `${intelligence.officialOwnershipProperties}/${intelligence.linkedProperties} owners · ${intelligence.utilityResolvedProperties} utilities · ${intelligence.rateResolvedProperties} rates` : 'Research required'}</strong></div>
              <div className="pm-detail-row"><span>Water benchmark</span><strong>{intelligence?.annualWaterSpendBenchmark ? `~$${Math.round(intelligence.annualWaterSpendBenchmark).toLocaleString()}/yr modeled` : 'Not enough sourced inputs'}</strong></div>
              <div className="pm-detail-row"><span>Next action</span><strong>{intelligence?.nextActions[0] ?? company.nextAction ?? 'Continue evidence-backed research'}</strong></div>
            </div>
            {buildings.length > 0 && <div className="pm-research-section" style={{ padding:'0 14px 14px' }}><span>Top buildings</span>{buildings.map((building) => <div key={building.propertyId ?? building.propertyName}><strong>{building.propertyName}</strong><small>{[`Priority ${building.score}/100`, building.provider, building.annualWaterSpendBenchmark ? `~$${Math.round(building.annualWaterSpendBenchmark).toLocaleString()}/yr` : undefined, building.gaps[0]].filter(Boolean).join(' · ')}</small></div>)}</div>}
          </article>;
        })}
      </section>
    </main>
  );
}
