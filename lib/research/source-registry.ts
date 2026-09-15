import type { SourceDefinition } from './types';

export const SOURCE_REGISTRY: SourceDefinition[] = [
  {
    id: 'nyc-acris',
    label: 'NYC ACRIS / Open Data',
    url: 'https://data.cityofnewyork.us/',
    geographies: ['NY', 'NYC'],
    authority: 'official',
    strategy: 'structured',
    capabilities: ['property.identity', 'property.owner'],
    reliability: 0.96, evidenceStrength: 0.98, expectedLatencyMs: 450, freshnessDays: 35, maxConcurrency: 6,
    notes: ['Use published datasets/data services rather than automating the ACRIS UI. Join document, legal and party observations by source identifiers.']
  },
  {
    id: 'nyc-hpd-registrations',
    label: 'NYC HPD Registrations + Registration Contacts',
    url: 'https://data.cityofnewyork.us/Housing-Development/Registration-Contacts/feu5-w2e2',
    geographies: ['NY', 'NYC'],
    authority: 'official',
    strategy: 'structured',
    capabilities: ['property.identity', 'property.owner', 'property.manager', 'person.decisionMaker', 'person.phone'],
    reliability: 0.95, evidenceStrength: 0.96, expectedLatencyMs: 500, freshnessDays: 45, maxConcurrency: 6,
    notes: ['Resolve the building through HPD Registrations (tesw-yqqr), then join Registration Contacts (feu5-w2e2) by registrationid. Preserve the exact contact type such as CorporateOwner, Agent or HeadOfficer.']
  },
  {
    id: 'nys-dos-business',
    label: 'New York Department of State Business Entity Database',
    url: 'https://dos.ny.gov/corporation-and-business-entity-search-database',
    geographies: ['NY'],
    authority: 'official',
    strategy: 'http',
    capabilities: ['company.identity', 'person.decisionMaker'],
    reliability: 0.94, evidenceStrength: 0.94, expectedLatencyMs: 850, freshnessDays: 45, maxConcurrency: 3,
    notes: ['Useful for legal entity identity and filing relationships; a registered agent or service address is not automatically a beneficial owner.']
  },
  {
    id: 'nj-parcel-mod4',
    label: 'NJ Parcels + MOD-IV',
    url: 'https://nj.gov/njgin/edata/parcels/',
    geographies: ['NJ'],
    authority: 'official',
    strategy: 'structured',
    capabilities: ['property.identity'],
    reliability: 0.94, evidenceStrength: 0.92, expectedLatencyMs: 500, freshnessDays: 120, maxConcurrency: 6,
    notes: ["Owner names can be unavailable/redacted under Daniel's Law; never convert a redacted owner field into a negative ownership finding."]
  },
  {
    id: 'nj-dores-business',
    label: 'NJ Division of Revenue Business Records',
    url: 'https://www.njportal.com/DOR/BusinessRecords/',
    geographies: ['NJ'],
    authority: 'official',
    strategy: 'http',
    capabilities: ['company.identity', 'person.decisionMaker'],
    reliability: 0.94, evidenceStrength: 0.94, expectedLatencyMs: 850, freshnessDays: 45, maxConcurrency: 3,
    notes: ['Entity records may expose principal, manager/managing-member, officer/director, registered-agent or associated-name information; retain the exact role.']
  },
  {
    id: 'pa-dos-business',
    label: 'Pennsylvania Department of State Business Entity Search',
    url: 'https://file.dos.pa.gov/search/business',
    geographies: ['PA'],
    authority: 'official',
    strategy: 'http',
    capabilities: ['company.identity', 'person.decisionMaker', 'person.title'],
    reliability: 0.94, evidenceStrength: 0.94, expectedLatencyMs: 850, freshnessDays: 45, maxConcurrency: 3,
    notes: ['Records are primarily indexed by entity name/number; officers or governors may be present but are not guaranteed.']
  },
  {
    id: 'pa-county-assessment',
    label: 'Pennsylvania County Assessment / Parcel Sources',
    geographies: ['PA'],
    authority: 'official',
    strategy: 'http',
    capabilities: ['property.identity', 'property.owner'],
    reliability: 0.90, evidenceStrength: 0.91, expectedLatencyMs: 1100, freshnessDays: 90, maxConcurrency: 3,
    notes: ['Pennsylvania is county-adapter driven. Capabilities vary by county; use official county GIS/assessment systems and recorder sources where available.']
  },
  {
    id: 'company-first-party-web',
    label: 'Company first-party website',
    geographies: ['US'],
    authority: 'first-party',
    strategy: 'http',
    capabilities: ['company.identity','company.website','company.phone','company.email','company.ownerOperator','company.portfolio','person.decisionMaker','person.title','person.phone','person.email'],
    reliability: 0.86, evidenceStrength: 0.82, expectedLatencyMs: 900, freshnessDays: 45, maxConcurrency: 4,
    notes: ['Crawl a bounded set of likely pages such as home, about, team/leadership, portfolio/properties and contact.']
  },
  {
    id: 'open-web-discovery',
    label: 'Open web discovery',
    geographies: ['US'],
    authority: 'discovery-only',
    strategy: 'web-discovery',
    capabilities: ['company.identity','company.website','company.phone','company.email','company.ownerOperator','company.portfolio','person.decisionMaker','person.title','person.phone','person.email','property.owner','property.manager','utility.provider','utility.amiCapability'],
    reliability: 0.55, evidenceStrength: 0.40, expectedLatencyMs: 1200, freshnessDays: 14, maxConcurrency: 3,
    notes: ['Discovery results create candidate claims only; follow promising results to authoritative or first-party pages before promotion.']
  },
  {
    id: 'utility-first-party-web',
    label: 'Water utility / municipal first-party sources',
    geographies: ['US'],
    authority: 'first-party',
    strategy: 'http',
    capabilities: ['utility.provider','utility.amiCapability'],
    reliability: 0.90, evidenceStrength: 0.90, expectedLatencyMs: 900, freshnessDays: 60, maxConcurrency: 4,
    notes: ['AMI program capability is not building-specific meter evidence. Service territory, program capability, and actual meter status are separate claims.']
  }
];

export function sourcesForFact(fact: SourceDefinition['capabilities'][number], geography?: string): SourceDefinition[] {
  return SOURCE_REGISTRY.filter((source) =>
    source.capabilities.includes(fact) &&
    (!geography || source.geographies.includes('US') || source.geographies.includes(geography))
  );
}
