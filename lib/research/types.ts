export type EvidenceState = "VERIFIED" | "SUPPORTED" | "INFERRED" | "CONFLICTED" | "UNRESOLVED";
export type SourceAuthority = "official" | "first-party" | "reputable-secondary" | "discovery-only";
export type FetchStrategy = "structured" | "http" | "web-discovery" | "browser";

export type ResearchFact =
  | "company.identity" | "company.website" | "company.phone" | "company.email"
  | "company.ownerOperator" | "company.portfolio"
  | "person.decisionMaker" | "person.title" | "person.phone" | "person.email"
  | "property.identity" | "property.owner" | "property.manager"
  | "utility.provider" | "utility.amiCapability" | "utility.buildingMeterStatus";

export interface SourceDefinition {
  id: string;
  label: string;
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
}

export interface PlannedSource {
  source: SourceDefinition;
  need: ResearchNeed;
  utility: number;
  reason: string;
}
