/**
 * Shared types for the Puma research engine (lib/engine).
 * Every fact the engine produces carries a Provenance so it can be written to `evidence`.
 */

export type SourceKind = 'discovery' | 'enrichment';

export type Provenance = {
  sourceId: string;
  sourceName: string;
  url: string;
  retrievedAt: string;
  method?: 'api' | 'scrape' | 'browser' | 'inferred' | 'derived';
  confidence?: number;
};

export type SourceInfo = {
  id: string;
  name: string;
  kind: SourceKind;
  /** Two-letter states, or ['US'] for nationwide, ['WEB'] for the open web. */
  coverage: string[];
  coverageLabel: string;
  capabilities: string[];
  description: string;
  homepage: string;
  /** How it was verified while building the connector. */
  verified: 'live' | 'needs-key' | 'unverified';
  /** Optional connectors that need env config. */
  requiresEnv?: string[];
};

export type ContactKind = 'person' | 'office';

/** A person (or role inbox) associated with a building or company. */
export type PersonRecord = {
  fullName: string;
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
  /** Normalized role bucket for the CRM. */
  roleCategory?: 'owner' | 'executive' | 'property_manager' | 'operations' | 'maintenance' | 'finance' | 'leasing' | 'other';
  isDecisionMaker?: boolean;
  email?: string | null;
  emailStatus?: 'published' | 'inferred' | 'unknown';
  phone?: string | null;
  linkedinUrl?: string | null;
  address?: string | null;
  organization?: string | null;
  provenance: Provenance;
};

/** A multifamily building as seen by one source. */
export type PropertyRecord = {
  /** Stable dedupe key, e.g. nyc-bbl:1022200005, nj-pin:0703_36.01_71, phl-opa:881158500, hud:800013957. */
  sourceKey: string;
  /** Cross-source keys this building is also known by (bbl:…, addr:…). */
  altKeys?: string[];
  name?: string | null;
  address: string;
  city?: string | null;
  state: string;
  zip?: string | null;
  county?: string | null;
  lat?: number | null;
  lon?: number | null;
  units?: number | null;
  /** True when `units` is an estimate (band midpoint, value-based) rather than a reported count. */
  unitsEstimated?: boolean;
  buildings?: number | null;
  yearBuilt?: number | null;
  stories?: number | null;
  buildingClass?: string | null;
  grossSqft?: number | null;
  assessedValue?: number | null;
  parcelId?: string | null;
  bbl?: string | null;
  ownerName?: string | null;
  ownerMailingAddress?: string | null;
  /** Normalized mailing key used for clustering (see engine/text.ts mailingKey). */
  mailingKey?: string | null;
  managerName?: string | null;
  /** Names that the record links to this building (owner LLC, agent, head officer...). */
  people?: PersonRecord[];
  utilityName?: string | null;
  utilityPwsid?: string | null;
  reportedWaterKgal?: number | null;
  reportedWaterYear?: number | null;
  energyStarScore?: number | null;
  provenance: Provenance;
  extra?: Record<string, unknown>;
};

export type DiscoverInput = {
  states: string[];
  counties?: string[];
  cities?: string[];
  zips?: string[];
  /** Portfolio total units range. */
  minUnits?: number;
  maxUnits?: number;
  /** Portfolio building-count range. */
  minBuildings?: number;
  maxBuildings?: number;
  /** Minimum units for a single building to be collected (default 10). */
  minBuildingUnits?: number;
  ownerType?: 'any' | 'owner_operator' | 'property_manager' | 'public_housing' | 'nonprofit';
  keywords?: string[];
  /** Max candidates to keep (default 50). */
  limit?: number;
  /** Skip website crawling (faster). */
  skipWebsites?: boolean;
};

export type EnrichInput = { companyId: string };

export type LogLevel = 'info' | 'warn' | 'error' | 'success';
export type LogLine = { at: string; level: LogLevel; message: string; source?: string };

export type ScoreFactor = { id: string; label: string; points: number; max: number; detail: string; known: boolean };
export type ScoreResult = { score: number; confidence: 'high' | 'medium' | 'low'; factors: ScoreFactor[] };

export type CandidateContact = {
  fullName: string;
  title?: string | null;
  roleCategory?: PersonRecord['roleCategory'];
  isDecisionMaker?: boolean;
  email?: string | null;
  emailStatus?: 'published' | 'inferred' | 'unknown';
  phone?: string | null;
  linkedinUrl?: string | null;
  organization?: string | null;
  sources: Provenance[];
  /** How many buildings this person is linked to. */
  buildings?: number;
};

export type EvidenceFact = {
  field: string;
  value: string;
  sourceId: string;
  sourceName: string;
  url?: string | null;
  method: 'api' | 'scrape' | 'browser' | 'inferred' | 'derived';
  confidence: number;
  retrievedAt: string;
  /** 'company' facts go on the company; 'property:<sourceKey>' facts go on a property. */
  entity?: string;
};

export type CandidateProperty = Omit<PropertyRecord, 'people' | 'provenance' | 'extra'> & {
  sourceId: string;
  sourceUrl: string;
  estAnnualWaterGallons?: number | null;
  estAnnualWaterCost?: number | null;
};

export type CandidateSummary = {
  portfolio: { buildings: number; units: number; unitsEstimated: boolean; sample: string[]; avgYearBuilt: number | null; states: string[] };
  contacts: CandidateContact[];
  sources: { id: string; name: string; records: number }[];
  mailingAddress?: string | null;
  website?: string | null;
  domain?: string | null;
  phone?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  estAnnualWaterSpend?: number | null;
  waterSpendBasis?: string | null;
  states: string[];
  why: string[];
  companyType: 'owner_operator' | 'property_manager' | 'developer' | 'reit' | 'nonprofit' | 'public_housing' | 'investor' | 'other' | 'unknown';
  aliases: string[];
  conflicts: string[];
  utilities: { name: string; pwsid: string; buildings: number }[];
  confidence: 'high' | 'medium' | 'low';
  properties: CandidateProperty[];
  evidence: EvidenceFact[];
  enriched?: boolean;
  enrichNotes?: string[];
};

/** In-memory candidate produced by resolve.ts. */
export type Candidate = {
  key: string;
  name: string;
  kind: 'company' | 'owner_cluster';
  nameConfidence: number;
  companyType: CandidateSummary['companyType'];
  properties: PropertyRecord[];
  contacts: CandidateContact[];
  mailingAddresses: string[];
  aliases: string[];
  conflicts: string[];
  website?: string | null;
  domain?: string | null;
  phone?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  evidence: EvidenceFact[];
  enrichNotes: string[];
  enriched?: boolean;
};
