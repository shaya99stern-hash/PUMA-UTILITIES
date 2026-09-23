'use client';

import Link from 'next/link';
import { Download, Search, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { workspaceProspectsCsv } from '@/lib/export-prospects';
import { rankWorkspacePropertyOpportunities } from '@/lib/research/property-priority';
import { companyResearchRecency } from '@/lib/research/research-snapshot';
import { stripLegacyReleaseOneSeeds } from '@/lib/seed';
import type { Company, Workspace } from '@/lib/types';
import { loadWorkspace, saveWorkspace } from '@/lib/workspace';
import { parseWorkspaceBackup, serializeWorkspaceBackup } from '@/lib/workspace-backup';

export default function PumaIntelligencePage() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [transferMessage, setTransferMessage] = useState('');
  const restoreInput = useRef<HTMLInputElement | null>(null);
  useEffect(() => { setWorkspace(stripLegacyReleaseOneSeeds(loadWorkspace())); }, []);

  const companies = useMemo(() => workspace ? [...workspace.companies].sort((a,b) => (b.opportunityIntelligence?.priority ?? -1) - (a.opportunityIntelligence?.priority ?? -1) || a.name.localeCompare(b.name)) : [], [workspace]);

  const downloadText = (text: string, filename: string, type: string) => {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  };
  const downloadCsv = () => {
    if (!workspace || workspace.companies.length === 0) return;
    downloadText(workspaceProspectsCsv(workspace), `puma-prospects-${new Date().toISOString().slice(0,10)}.csv`, 'text/csv;charset=utf-8');
  };
  const downloadBackup = () => {
    if (!workspace) return;
    downloadText(serializeWorkspaceBackup(workspace), `puma-workspace-backup-${new Date().toISOString().slice(0,10)}.json`, 'application/json;charset=utf-8');
    setTransferMessage('Workspace backup downloaded.');
  };
  const restoreBackup = async (file?: File) => {
    if (!file) return;
    try {
      const restored = stripLegacyReleaseOneSeeds(parseWorkspaceBackup(await file.text()));
      if (!saveWorkspace(restored)) throw new Error('Browser storage did not accept the restored workspace.');
      setWorkspace(restored);
      setTransferMessage(`Restored ${restored.companies.length} companies and ${restored.properties.length} properties.`);
    } catch (error) {
      setTransferMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (restoreInput.current) restoreInput.current.value = '';
    }
  };

  if (!workspace) return <main className="pm-shell"><div className="pm-loading">Loading intelligence…</div></main>;

  return (
    <main className="pm-recovery" style={{ placeItems:'start center' }}>
      <section className="pm-recovery-card" style={{ width:'min(100%, 980px)' }}>
        <div className="pm-page-head">
          <div><h1>Prospect Intelligence</h1><p>Evidence-backed priority, research recency, tariff freshness, and building-level opportunity.</p></div>
          <button className="pm-text-button" type="button" onClick={downloadCsv} disabled={companies.length === 0}><Download size={16} /> Export CSV</button>
        </div>
        <div className="pm-recovery-actions" style={{ marginBottom:12 }}><Link href="/clients">Companies</Link><Link href="/engine"><Search size={15} /> Find Leads</Link></div>
        <section className="pm-profile-settings" style={{ marginBottom:18 }}>
          <div><strong>Workspace transfer</strong><p className="pm-muted">Move the complete local workspace between iPhone and desktop with a guarded JSON backup. This is manual transfer, not cloud sync.</p></div>
          <div className="pm-recovery-actions">
            <button type="button" onClick={downloadBackup}><Download size={15} /> Download workspace backup</button>
            <button type="button" onClick={() => restoreInput.current?.click()}><Upload size={15} /> Restore backup</button>
            <input ref={restoreInput} hidden type="file" accept="application/json,.json" onChange={(event) => void restoreBackup(event.target.files?.[0])} />
          </div>
          {transferMessage && <small>{transferMessage}</small>}
        </section>
        {companies.length === 0 && <div className="pm-empty"><strong>No researched prospects yet.</strong><span>Research and save a real company first.</span></div>}
        {companies.map((company) => {
          const recency = companyResearchRecency(workspace, company.id);
          const buildings = rankWorkspacePropertyOpportunities(workspace, company.id).slice(0,5);
          const intelligence = company.opportunityIntelligence;
          const propertyIds = new Set(workspace.properties.filter((property) => property.companyId === company.id).map((property) => property.id));
          const utilityIds = new Set(workspace.utilities.filter((utility) => propertyIds.has(utility.propertyId)).map((utility) => utility.id));
          const tariffs = workspace.tariffs.filter((tariff) => utilityIds.has(tariff.utilityServiceId));
          const tariffFreshness = tariffs.reduce((acc, tariff) => { const key = tariff.freshness ?? 'unknown'; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {} as Record<string, number>);
          return <article key={company.id} className="pm-home-panel" style={{ marginBottom:14 }}>
            <div className="pm-home-panel-head"><div><span>{company.market || 'Market unresolved'} · {company.stage}</span><strong>{company.name}</strong></div><div className="pm-recovery-actions"><Link href={researchHref(company)}><Search size={14} /> Continue research</Link><Link href={`/clients/${encodeURIComponent(company.id)}`}>Open company</Link></div></div>
            <div className="pm-detail-stack" style={{ border:0, borderRadius:0 }}>
              <div className="pm-detail-row"><span>Priority</span><strong>{intelligence ? `${intelligence.priority}/100 · ${intelligence.confidence}` : 'Not scored yet'}</strong></div>
              <div className="pm-detail-row"><span>Research recency</span><strong>{recency.status}{recency.latestRetrievedAt ? ` · ${new Date(recency.latestRetrievedAt).toLocaleDateString()}` : ''}</strong></div>
              <div className="pm-detail-row"><span>Coverage</span><strong>{intelligence ? `${intelligence.officialOwnershipProperties}/${intelligence.linkedProperties} owners · ${intelligence.utilityResolvedProperties} utilities · ${intelligence.rateResolvedProperties} rates` : 'Research required'}</strong></div>
              <div className="pm-detail-row"><span>Tariff freshness</span><strong>{tariffs.length ? `${tariffFreshness.current ?? 0} current · ${tariffFreshness.expired ?? 0} expired · ${tariffFreshness.future ?? 0} future · ${tariffFreshness.unknown ?? 0} unknown` : 'No persisted tariffs yet'}</strong></div>
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

function researchHref(company: Company): string {
  const params = new URLSearchParams({ company:company.name });
  if (company.market) params.set('state', company.market);
  if (company.website) params.set('website', company.website);
  return `/engine?${params.toString()}`;
}
