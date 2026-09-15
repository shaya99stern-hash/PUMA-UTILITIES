export type EvidenceState = 'VERIFIED' | 'SUPPORTED' | 'INFERRED' | 'CONFLICTED' | 'UNRESOLVED';
export type SourceAuthority = 'official' | 'first-party' | 'reputable-secondary' | 'discovery-only';
export type FetchStrategy = 'structured' | 'http' | 'web-discovery' | 'browser';

export type ResearchFact =
  | 'company.identity' | 'company.website' | 'company.phone' | 'company.email'
  | 'company.ownerOperator' | 'company.portfolio'
  | 'person.decisionMaker' | 'person.title' | 'person.phone' | 'person.email'
  | 'property.identity' | 'property.owner' | 'property.manager'
  | 'utility.provider' | 'utility.amiCapability' | 'utility.buildingMeterStatus';

export type ResearchEntityKind = 'company' | 'person' | 'property' | 'utility' | 'domain' | 'organization';

export interface SourceDefinition {
  id: string;
  label: string;
  url?: string;
  geographies: string[];
  authority: SourceAuthority;
  strategy: FetchStrategy;
  capabilities: ResearchFact[];
  reliability: number;
  evidenceStrength: number;
  expectedLatencyMs: number;
  freshnessDays: number;
  maxConcurrency: number;
  notes?: string[];
}

export interface ResearchNeed {
  fact: ResearchFact;
  geography?: string;
  importance: number;
  subjectId?: string;
}

export interface PlannedSource {
  source: SourceDefinition;
  need: ResearchNeed;
  utility: number;
  reason: string;
}

export interface ResearchEntity {
  id: string;
  kind: ResearchEntityKind;
  label: string;
  normalizedLabel: string;
  geography?: string;
  aliases?: string[];
}

export interface ResearchEvidence {
  id: string;
  sourceId: string;
  url: string;
  observedAt: string;
  authority: SourceAuthority;
  confidence: number;
  excerpt?: string;
}

export interface ResearchClaim {
  id: string;
  subjectId: string;
  fact: ResearchFact;
  value?: string | number | boolean;
  objectEntityId?: string;
  state: EvidenceState;
  confidence: number;
  evidenceIds: string[];
  observedAt: string;
}

export interface ResearchGraph {
  entities: ResearchEntity[];
  evidence: ResearchEvidence[];
  claims: ResearchClaim[];
}

export type ResearchTaskStatus = 'queued' | 'running' | 'complete' | 'blocked' | 'failed';

export interface ResearchTask {
  id: string;
  subjectId: string;
  need: ResearchNeed;
  sourceId: string;
  status: ResearchTaskStatus;
  depth: number;
  utility: number;
  reason: string;
}
