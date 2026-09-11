import type { Company } from './types';

export type ClientSegment = 'prospects' | 'active';
export type ProspectStatus = 'All' | 'Needs Outreach' | 'Contacted' | 'Follow-up' | 'Negotiation' | 'Installation';

export function clientSegmentFor(company: Company): ClientSegment {
  return company.stage === 'Client' ? 'active' : 'prospects';
}

export function prospectStatusFor(company: Company): Exclude<ProspectStatus, 'All'> {
  switch (company.stage) {
    case 'Target':
    case 'Research':
      return 'Needs Outreach';
    case 'Outreach':
      return 'Contacted';
    case 'Follow-up':
      return 'Follow-up';
    case 'Qualified':
    case 'Pilot':
      return 'Negotiation';
    case 'Installation':
      return 'Installation';
    case 'Client':
      return 'Contacted';
    case 'Archived':
      return 'Needs Outreach';
  }
}

export function matchesProspectStatus(company: Company, status: ProspectStatus): boolean {
  if (clientSegmentFor(company) !== 'prospects') return false;
  return status === 'All' || prospectStatusFor(company) === status;
}
