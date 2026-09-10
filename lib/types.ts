export type StateCode = 'NJ' | 'NY' | 'PA';

/**
 * How Puma is allowed to describe a value. `unknown` is intentionally
 * different from zero: an absent source must never turn into a negative
 * signal or a made-up opportunity.
 */
export type EvidenceStatus =
  | 'verified-public'
  | 'client-authorized'
  | 'estimated'
  | 'unknown';

export type PipelineStage =
  | 'Target'
  | 'Research'
  | 'Qualified'
  | 'Outreach'
  | 'Client'
  | 'Archived';

export type Provenance = {
  id: string;
  label: string;
  status: EvidenceStatus;
  /** A public URL, document identifier, or client-provided reference. */
  reference?: string;
  /** ISO date of retrieval or receipt, if known. */
  retrievedAt?: string;
  note?: string;
};

export type EvidenceValue<T> = {
  value?: T;
  status: EvidenceStatus;
  provenanceId?: string;
  updatedAt?: string;
};

/**
 * A public portfolio statement is deliberately kept separate from a verified
 * building count. For example, "33 locations" must never be presented as
 * "33 buildings" merely because it is useful for a score.
 */
export type PortfolioMetricLabel =
  | 'buildings'
  | 'properties'
  | 'locations'
  | 'communities'
  | 'apartments';

export type PortfolioMetric = {
  value: number;
  label: PortfolioMetricLabel;
  /** Whether the public statement is a lower bound (rendered as "30+"). */
  qualifier?: 'at-least' | 'exact';
  status: EvidenceStatus;
  provenanceId?: string;
  statement?: string;
};

export type Person = {
  id: string;
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  status: EvidenceStatus;
  provenanceId?: string;
};

export type Company = {
  id: string;
  name: string;
  stage: PipelineStage;
  market?: StateCode;
  headquarters: EvidenceValue<string>;
  portfolioBuildings: EvidenceValue<number>;
  portfolioUnits: EvidenceValue<number>;
  /** Accurately-labelled public statements, including non-building counts. */
  portfolio?: PortfolioMetric[];
  people: Person[];
  provenance: Provenance[];
  /** A documented discovery path, not a statement of active service. */
  researchPathways?: string[];
  nextAction?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type Parcel = {
  id: string;
  propertyId: string;
  identifier: string;
  jurisdiction?: string;
  status: EvidenceStatus;
  provenanceId?: string;
};

export type Property = {
  id: string;
  companyId: string;
  name: string;
  address: EvidenceValue<string>;
  state: StateCode;
  parcelIds: string[];
  provenance: Provenance[];
  createdAt: string;
  updatedAt: string;
};

export type MeterCapability =
  | 'smart-meter'
  | 'newly-installed'
  | 'manual-read'
  | 'unknown';

export type PortalCapability =
  | 'authorized-interval'
  | 'public-portal'
  | 'not-visible'
  | 'unknown';

export type UtilityService = {
  id: string;
  propertyId: string;
  provider: string;
  serviceArea?: string;
  capability: MeterCapability;
  portal: PortalCapability;
  status: EvidenceStatus;
  provenanceId?: string;
};

export type UsageReading = {
  id: string;
  meterId: string;
  periodStart?: string;
  periodEnd?: string;
  gallons?: number;
  expectedGallons?: number;
  cost?: number;
  continuousFlow?: boolean;
  status: EvidenceStatus;
  provenanceId?: string;
  note?: string;
};

export type Meter = {
  id: string;
  utilityServiceId: string;
  label: string;
  readings: UsageReading[];
  createdAt: string;
  updatedAt: string;
};

/**
 * A tariff is intentionally a sourced, effective-dated record. Puma never
 * supplies a default rate or turns a tariff into a bill without authorization.
 */
export type Tariff = {
  id: string;
  utilityServiceId: string;
  label: string;
  effectiveFrom: string;
  effectiveTo?: string;
  status: EvidenceStatus;
  provenanceId?: string;
  note?: string;
};

export type MonitorSettings = {
  /** Currency amount per authorized reading period. Undefined means off. */
  spendThreshold?: number;
  /** Percent above an authorized expected-use baseline. Undefined means off. */
  varianceThresholdPercent?: number;
};

export type Workspace = {
  version: 1;
  companies: Company[];
  properties: Property[];
  parcels: Parcel[];
  utilities: UtilityService[];
  meters: Meter[];
  tariffs: Tariff[];
  monitorSettings: MonitorSettings;
  updatedAt: string;
};

export type ScoreFactorId =
  | 'portfolio'
  | 'data-availability'
  | 'meter-portal'
  | 'suspected-excess'
  | 'decision-maker';

export type ScoreFactor = {
  id: ScoreFactorId;
  label: string;
  maxPoints: number;
  points?: number;
  state: 'evidenced' | 'unknown';
  detail: string;
};

export type OpportunityScore = {
  factors: ScoreFactor[];
  /** A score is published only when every factor has evidence. */
  total?: number;
  completeness: number;
};

export type AlertKind = 'Continuous flow' | 'Spend threshold' | 'Unexpected use';

export type MonitorAlert = {
  id: string;
  companyId: string;
  propertyId: string;
  meterId: string;
  kind: AlertKind;
  title: string;
  detail: string;
  periodEnd?: string;
  status: 'client-authorized';
  provenanceId?: string;
};

export type SourceCatalogEntry = {
  id: string;
  name: string;
  markets: StateCode[];
  kind:
    | 'Official open data'
    | 'Official GIS'
    | 'Official rate reference'
    | 'Official program reference';
  access: 'Public download/API' | 'Manual review required';
  url: string;
  description: string;
};
