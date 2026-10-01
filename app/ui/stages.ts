/** Pipeline stages (DB `companies.stage`) with display metadata. */
export type StageKey = 'new' | 'qualified' | 'contacted' | 'meeting' | 'proposal' | 'installation' | 'client' | 'lost';

export type StageMeta = {
  key: StageKey;
  label: string;
  /** Solid color for dots, kanban column accents and charts. */
  color: string;
  /** Short description for tooltips / empty states. */
  description: string;
};

export const STAGES: readonly StageMeta[] = [
  { key: 'new', label: 'New lead', color: '#8e8e96', description: 'Found but not yet reviewed.' },
  { key: 'qualified', label: 'Qualified', color: '#5ea8ff', description: 'Fits the ideal customer profile.' },
  { key: 'contacted', label: 'Contacted', color: '#a58bff', description: 'Outreach has started.' },
  { key: 'meeting', label: 'Meeting', color: '#f5b544', description: 'A meeting is booked or held.' },
  { key: 'proposal', label: 'Proposal', color: '#ff7a45', description: 'Proposal sent, awaiting decision.' },
  { key: 'installation', label: 'Installation', color: '#2fc4c4', description: 'Signed; meters being installed.' },
  { key: 'client', label: 'Client', color: '#3ecf8e', description: 'Active Puma client.' },
  { key: 'lost', label: 'Lost', color: '#f2555a', description: 'Not moving forward.' },
] as const;

export const STAGE_KEYS: readonly StageKey[] = STAGES.map((s) => s.key);

const BY_KEY = new Map<string, StageMeta>(STAGES.map((s) => [s.key, s]));

export function stageMeta(key: string | null | undefined): StageMeta {
  return BY_KEY.get(key ?? '') ?? STAGES[0];
}

export function isStageKey(value: unknown): value is StageKey {
  return typeof value === 'string' && BY_KEY.has(value);
}
