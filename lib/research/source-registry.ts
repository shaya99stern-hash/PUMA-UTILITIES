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
    id: 'nyc-pluto',
    label: 'NYC PLUTO',
    url: 'https://data.cityofnewyork.us/City-Government/Primary-Land-Use-Tax-Lot-Output-PLUTO-/64uk-42ks',
    geographies: ['NY', 'NYC'],
    authority: 'official',
    strategy: 'structured',
    capabilities: ['property.units','property.grossSquareFeet'],
    reliability: 0.96, evidenceStrength: 0.96, expectedLatencyMs: 450, freshnessDays: 120, maxConcurrency: 6,
    notes: [
      'Resolve by an already corroborated NYC BBL. UnitsRes is residential units on the tax lot.',
      'BldgArea is not promoted to gross-square-footage for condominium records because PLUTO documents condo area as net rather than gross.'
    ]
  },
  {
    id: 'nyc-hpd-registrations',
    label: 'NYC HPD Registrations + Registration Contacts',
    url: 'https://data.cityofnewyork.us/Housing-Development/Registration-Contacts/feu5-w2e2',
    geographies: ['NY', 'NYC'],
    authority: 'official',
    strategy: 'structured',
    capabilities: ['property.identity', 'property.owner', 'property.manager'],
    reliability: 0.95, evidenceStrength: 0.96, expectedLatencyMs: 500, freshnessDays: 45, maxConcurrency: 6,
    notes: ['Resolve the building through HPD Registrations (tesw-yqqr), then join Registration Contacts (feu5-w2e2) by registrationid. Preserve the exact contact type such as CorporateOwner, Agent or HeadOfficer.']
  },
  {
    id: 'nys-tax-parcels-public',
    label: 'New York State Public Tax Parcels',
    url: 'https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/FeatureServer/1',
    geographies: ['NY'],
    authority: 'official',
    strategy: 'structured',
    capabilities: ['property.owner','property.grossSquareFeet'],
    reliability: 0.93, evidenceStrength: 0.94, expectedLatencyMs: 600, freshnessDays: 365, maxConcurrency: 5,
    notes: [
      'Annual statewide publication currently covers participating counties only; absence from this layer is never treated as negative ownership evidence.',
      'Use a unique exact street-address match and preserve parcel/roll provenance. GFA may be used as gross-area evidence; this adapter does not infer unit counts.'
    ]
  },
  {
    id: 'nys-dos-business',
    label: 'New York Department of State Business Entity Database',
    url: 'https://dos.ny.gov/corporation-and-business-entity-search-database',
    geographies: ['NY'],
    authority: 'official',
    strategy: 'http',
    capabilities: ['company.identity'],
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
    capabilities: ['property.identity', 'property.owner', 'property.units'],
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
    capabilities: ['company.identity'],
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
    capabilities: ['company.identity'],
    reliability: 0.94, evidenceStrength: 0.94, expectedLatencyMs: 850, freshnessDays: 45, maxConcurrency: 3,
    notes: ['Records are primarily indexed by entity name/number; officers or governors may be present but are not guaranteed.']
  },
  {
    id: 'phila-opa-properties',
    label: 'Philadelphia Office of Property Assessment',
    url: 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/OPA_PROPERTIES_PUBLIC/FeatureServer/0',
    geographies: ['PA'],
    authority: 'official',
    strategy: 'structured',
    capabilities: ['property.owner'],
    reliability: 0.96, evidenceStrength: 0.96, expectedLatencyMs: 500, freshnessDays: 7, maxConcurrency: 5,
    notes: [
      'Philadelphia-only current OPA property roll. Use owner-of-record and parcel number as official corroboration.',
      'Do not relabel total_livable_area as gross building square footage.'
    ]
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
    id: 'epa-water-service-areas',
    label: 'US EPA Public Water System Service Areas',
    url: 'https://www.epa.gov/ground-water-and-drinking-water/public-water-system-service-areas',
    geographies: ['US'],
    authority: 'official',
    strategy: 'structured',
    capabilities: ['utility.provider'],
    reliability: 0.88, evidenceStrength: 0.88, expectedLatencyMs: 650, freshnessDays: 120, maxConcurrency: 5,
    notes: ['National coverage; boundaries may be state/system sourced or EPA-modeled. Preserve boundary provenance and never present a modeled polygon as a confirmed customer account.']
  },
  {
    id: 'njdep-water-purveyor',
    label: 'NJDEP Public Community Water Purveyor Service Areas',
    url: 'https://mapsdep.nj.gov/arcgis/rest/services/Features/Utilities/MapServer/13',
    geographies: ['NJ'],
    authority: 'official',
    strategy: 'structured',
    capabilities: ['utility.provider'],
    reliability: 0.94, evidenceStrength: 0.95, expectedLatencyMs: 550, freshnessDays: 365, maxConcurrency: 5,
    notes: ['Maps actual public community water delivery/service areas rather than future franchise areas. The published layer is older, so corroborate with current utility/local sources for outreach-critical decisions.']
  },
  {
    id: 'padep-water-service',
    label: 'PADEP Public Water Supplier Service Areas',
    url: 'https://mapservices.pasda.psu.edu/server/rest/services/pasda/DEP2/MapServer/8',
    geographies: ['PA'],
    authority: 'official',
    strategy: 'structured',
    capabilities: ['utility.provider'],
    reliability: 0.94, evidenceStrength: 0.95, expectedLatencyMs: 550, freshnessDays: 120, maxConcurrency: 5,
    notes: ['Current public-water-supplier service-area polygons; boundaries are approximate and should be treated as service-territory evidence, not customer-account confirmation.']
  },
  {
    id: 'sec-edgar',
    label: 'SEC EDGAR filings and submissions',
    url: 'https://www.sec.gov/edgar',
    geographies: ['US'],
    authority: 'official',
    strategy: 'structured',
    capabilities: ['company.identity','person.decisionMaker'],
    reliability: 0.97, evidenceStrength: 0.97, expectedLatencyMs: 700, freshnessDays: 7, maxConcurrency: 2,
    notes: ['Applies only to SEC filers. Prefer recent DEF 14A, then 10-K/8-K leadership disclosures.']
  },
  {
    id: 'person-company-first-party',
    label: 'Named person on company first-party website',
    geographies: ['US'],
    authority: 'first-party',
    strategy: 'http',
    capabilities: ['person.title','person.phone','person.email'],
    reliability: 0.9, evidenceStrength: 0.88, expectedLatencyMs: 850, freshnessDays: 30, maxConcurrency: 3,
    notes: ['Search only the resolved company domain for the named person; never infer an email pattern as a verified contact.']
  },
  {
    id: 'company-first-party-web',
    label: 'Company first-party website',
    geographies: ['US'],
    authority: 'first-party',
    strategy: 'http',
    capabilities: ['company.identity','company.website','company.phone','company.email','company.ownerOperator','company.portfolio','person.decisionMaker'],
    reliability: 0.86, evidenceStrength: 0.82, expectedLatencyMs: 900, freshnessDays: 45, maxConcurrency: 4,
    notes: ['Crawl a bounded set of likely pages such as home, about, team/leadership, portfolio/properties and contact.']
  },
  {
    id: 'contactout-public-directory',
    label: 'ContactOut public company/people directory',
    url: 'https://contactout.com/',
    geographies: ['US'],
    authority: 'reputable-secondary',
    strategy: 'browser',
    capabilities: ['person.decisionMaker'],
    reliability: 0.74, evidenceStrength: 0.68, expectedLatencyMs: 1800, freshnessDays: 30, maxConcurrency: 2,
    notes: [
      'Use only names and roles visibly available without bypassing authentication, a paywall, or a contact-credit gate.',
      'Treat directory roles as candidate evidence and cross-check current first-party sources before outreach-critical use.'
    ]
  },
  {
    id: 'open-web-discovery',
    label: 'Open web discovery',
    geographies: ['US'],
    authority: 'discovery-only',
    strategy: 'web-discovery',
    capabilities: ['company.identity','company.website','company.phone','company.email','company.ownerOperator','company.portfolio','person.decisionMaker','person.title','person.phone','person.email','property.owner','property.manager','utility.provider','utility.amiCapability','utility.rateSchedule'],
    reliability: 0.55, evidenceStrength: 0.40, expectedLatencyMs: 1200, freshnessDays: 14, maxConcurrency: 3,
    notes: ['Discovery results create candidate claims only; follow promising results to authoritative or first-party pages before promotion.']
  },
  {
    id: 'utility-first-party-web',
    label: 'Water utility / municipal first-party sources',
    geographies: ['US'],
    authority: 'first-party',
    strategy: 'http',
    capabilities: ['utility.provider','utility.amiCapability','utility.rateSchedule'],
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
