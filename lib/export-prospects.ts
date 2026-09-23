import { companyResearchRecency } from './research/research-snapshot';
import type { Workspace } from './types';

const HEADERS = ['Company','Market','Stage','Priority','Confidence','Portfolio','Top Contact','Email','Phone','Linked Properties','Official Owners','Utilities','Rates','Annual Water Benchmark','Next Action','Last Researched','Research Recency'];

export function workspaceProspectsCsv(workspace: Workspace, companyIds?: string[]): string {
  const selected = companyIds?.length ? new Set(companyIds) : undefined;
  const rows = workspace.companies
    .filter((company) => !selected || selected.has(company.id))
    .sort((a,b) => (b.opportunityIntelligence?.priority ?? -1) - (a.opportunityIntelligence?.priority ?? -1) || a.name.localeCompare(b.name))
    .map((company) => {
      const intelligence = company.opportunityIntelligence;
      const top = intelligence?.topContact;
      const person = top ? company.people.find((candidate) => candidate.name.toLowerCase() === top.name.toLowerCase()) : undefined;
      const portfolio = company.portfolio?.find((item) => ['buildings','properties','communities','locations'].includes(item.label));
      const recency = companyResearchRecency(workspace, company.id);
      return [
        company.name,
        company.market ?? '',
        company.stage,
        intelligence?.priority ?? '',
        intelligence?.confidence ?? '',
        portfolio?.statement ?? (portfolio ? `${portfolio.qualifier === 'at-least' ? 'at least ' : ''}${portfolio.value} ${portfolio.label}` : ''),
        top?.name ?? '',
        person?.email ?? company.publicEmail ?? '',
        person?.phone ?? company.publicPhone ?? '',
        intelligence?.linkedProperties ?? '',
        intelligence?.officialOwnershipProperties ?? '',
        intelligence?.utilityResolvedProperties ?? '',
        intelligence?.rateResolvedProperties ?? '',
        intelligence?.annualWaterSpendBenchmark ?? '',
        intelligence?.nextActions[0] ?? company.nextAction ?? '',
        recency.latestRetrievedAt ?? '',
        recency.status,
      ];
    });
  return [HEADERS, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function csvCell(value: string | number): string {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
