import type { PipelineStage } from './types';

export type CompanyLifecycle =
  | 'Prospects'
  | 'Contacted'
  | 'Not Interested'
  | 'Installations'
  | 'Active Clients';

export const COMPANY_LIFECYCLES: CompanyLifecycle[] = [
  'Prospects',
  'Contacted',
  'Not Interested',
  'Installations',
  'Active Clients',
];

export function companyLifecycle(stage: PipelineStage): CompanyLifecycle {
  if (stage === 'Client') return 'Active Clients';
  if (stage === 'Installation') return 'Installations';
  if (stage === 'Not Interested' || stage === 'Archived') return 'Not Interested';
  if (stage === 'Outreach' || stage === 'Follow-up' || stage === 'Pilot') return 'Contacted';
  return 'Prospects';
}
