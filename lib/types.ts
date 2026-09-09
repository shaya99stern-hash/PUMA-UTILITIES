export type StateCode = 'NJ' | 'NY' | 'PA';

export type Utility = {
  id: string;
  name: string;
  state: StateCode;
  meterStatus: 'AMI mature' | 'AMI rolling out' | 'Mixed / unknown';
  portalCapability: string;
  publicData: string;
  rateSource: string;
};

export type Prospect = {
  id: string;
  company: string;
  state: StateCode;
  headquarters: string;
  portfolioBuildings: number;
  portfolioUnits: number;
  portfolioNote: string;
  decisionMaker: string;
  decisionRole: string;
  utilityIds: string[];
  meterOpportunity: number;
  publicDataCoverage: number;
  annualWaterExposure: number;
  anomalySignal: number;
  reachability: number;
  stage: 'Research' | 'Qualified' | 'Watch' | 'Client';
  confidence: 'Verified public' | 'Research seed' | 'Estimated';
  nextAction: string;
};

export type IngestionSource = {
  id: string;
  name: string;
  geography: string;
  category: string;
  status: 'Scaffolded' | 'Ready to wire' | 'Researching';
  description: string;
};
