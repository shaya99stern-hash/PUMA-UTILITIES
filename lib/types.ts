export type StateCode = string;

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
  | 'Follow-up'
  | 'Pilot'
  | 'Installation'
  | 'Client'
  | 'Archived';

export type InstallationStatus =
  | 'Not started'
  | 'Site visit'
  | 'Scheduled'
  | 'Installed'
  | 'Live';

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

export type PortfolioMetricLabel =
  | 'buildings'
  | 'properties'
  | 'locations'
  | 'communities'
  | 'apartments';

export type PortfolioMetric = {
  value: number;
  label: PortfolioMetricLabel;
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

export type ActivityNote = {
  id: string;
  text: string;
  createdAt: string;
  source: 'typed' | 'voice';
  companyId?: string;
  propertyId?: string;
};

export type Company = {
  id: string;
  name: string;
  stage: PipelineStage;
  market?: StateCode;
  headquarters: EvidenceValue<string>;
  portfolioBuildings: EvidenceValue<number>;
  portfolioUnits: EvidenceValue<number>;
  portfolio?: PortfolioMetric[];
  people: Person[];
  provenance: Provenance[];
  researchPathways?: string[];
  nextAction?: string;
  notes?: string;
  activityNotes?: ActivityNote[];
  installationStatus?: InstallationStatus;
  lastContactAt?: string;
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
  spendThreshold?: number;
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
  inboxNotes?: ActivityNote[];
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