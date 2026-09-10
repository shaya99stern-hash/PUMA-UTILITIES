import type { Company, EvidenceStatus, Provenance, Workspace } from './types';

/**
 * Release 1 ships public research targets only. These are intentionally not
 * prospective client records, property matches, utility accounts, or usage
 * records. The static seed also backs the safe public summary API; browser
 * workspace changes remain local to the operator's device.
 */
export const WORKSPACE_RELEASE = 'release-1-public-research';
export const RELEASE_RETRIEVED_AT = '2026-09-10T00:00:00.000Z';

export const RELEASE_ONE_COMPANY_IDS = [
  'algin-ny',
  'gpg-ny',
  'legow-nj',
  'liss-pa',
  'gy-properties-pa',
] as const;

function publicSource(id: string, label: string, reference: string, note: string): Provenance {
  return {
    id,
    label,
    status: 'verified-public',
    reference,
    retrievedAt: RELEASE_RETRIEVED_AT,
    note,
  };
}

function researchCompany(company: Omit<Company, 'createdAt' | 'updatedAt'>): Company {
  return {
    ...company,
    createdAt: RELEASE_RETRIEVED_AT,
    updatedAt: RELEASE_RETRIEVED_AT,
  };
}

function sourceStatus(status: EvidenceStatus) {
  return status;
}

/** Returns a fresh object so UI mutations can never modify the shared seed. */
export function createReleaseOneWorkspace(): Workspace {
  const alginSource = publicSource(
    'source-algin-site',
    'Algin Management public company site',
    'https://alginny.com/',
    'Public company statement: more than 30 NYC rental buildings and more than 3,500 apartments.',
  );
  const gpgSource = publicSource(
    'source-gpg-site',
    'GPG Management public company site',
    'https://gpg.management/',
    'Public company statement: more than 100 properties and 3,000 apartments.',
  );
  const legowSource = publicSource(
    'source-legow-site',
    'Legow Management public company site',
    'https://www.legow.com/',
    'Public company statement: 33 New Jersey locations. This is not represented as a building count.',
  );
  const lissSource = publicSource(
    'source-liss-site',
    'Liss Property Group public company site',
    'https://www.lisspropertygroup.com/',
    'Public company statement: 18 Philadelphia-area apartment communities.',
  );
  const gySource = publicSource(
    'source-gy-properties-site',
    'GY Properties public portfolio',
    'https://www.gy-properties.com/properties/',
    'Public portfolio statement: 60 properties, with in-house management and development activity.',
  );

  const companies: Company[] = [
    researchCompany({
      id: 'algin-ny',
      name: 'Algin Management',
      stage: 'Research',
      market: 'NY',
      headquarters: { status: 'unknown' },
      // This is the one seed whose public statement explicitly uses buildings.
      portfolioBuildings: {
        value: 30,
        status: sourceStatus('verified-public'),
        provenanceId: alginSource.id,
        updatedAt: RELEASE_RETRIEVED_AT,
      },
      portfolioUnits: {
        value: 3500,
        status: sourceStatus('verified-public'),
        provenanceId: alginSource.id,
        updatedAt: RELEASE_RETRIEVED_AT,
      },
      portfolio: [
        { value: 30, label: 'buildings', qualifier: 'at-least', status: 'verified-public', provenanceId: alginSource.id, statement: '30+ NYC rental buildings' },
        { value: 3500, label: 'apartments', qualifier: 'at-least', status: 'verified-public', provenanceId: alginSource.id, statement: '3,500+ apartments' },
      ],
      people: [],
      provenance: [alginSource],
      researchPathways: [
        'Resolve a named property and confirm any public annual benchmarking match before treating it as a water research signal.',
        'Use official service-area or DEP research references only after an address is sourced; no account, meter, tariff, or portal access is currently confirmed.',
      ],
      nextAction: 'Resolve one public property/address and retain its source before a utility or benchmark review.',
      notes: 'Public research target only — never an active client or a confirmed water issue.',
    }),
    researchCompany({
      id: 'gpg-ny',
      name: 'GPG Management',
      stage: 'Research',
      market: 'NY',
      headquarters: { status: 'unknown' },
      // The source says properties, not buildings; keep the score input unknown.
      portfolioBuildings: { status: 'unknown' },
      portfolioUnits: {
        value: 3000,
        status: sourceStatus('verified-public'),
        provenanceId: gpgSource.id,
        updatedAt: RELEASE_RETRIEVED_AT,
      },
      portfolio: [
        { value: 100, label: 'properties', qualifier: 'at-least', status: 'verified-public', provenanceId: gpgSource.id, statement: '100+ properties' },
        { value: 3000, label: 'apartments', qualifier: 'at-least', status: 'verified-public', provenanceId: gpgSource.id, statement: '3,000+ apartments' },
      ],
      people: [],
      provenance: [gpgSource],
      researchPathways: [
        'Resolve a public property match before reviewing any annual NYC water disclosure record.',
        'A utility mapping or public portal path must not be represented as an active property account or authorization.',
      ],
      nextAction: 'Source a specific portfolio property and determine whether an official annual benchmarking record is applicable.',
      notes: 'Public research target only — no property, utility, bill, reading, or decision-maker record is asserted.',
    }),
    researchCompany({
      id: 'legow-nj',
      name: 'Legow Management',
      stage: 'Research',
      market: 'NJ',
      headquarters: { status: 'unknown' },
      portfolioBuildings: { status: 'unknown' },
      portfolioUnits: { status: 'unknown' },
      portfolio: [
        { value: 33, label: 'locations', qualifier: 'exact', status: 'verified-public', provenanceId: legowSource.id, statement: '33 New Jersey locations' },
      ],
      people: [],
      provenance: [legowSource],
      researchPathways: [
        'Resolve a public property address, then compare it with the NJDEP published community-water-purveyor service-area reference.',
        'A spatial service-area result is only an inference and cannot confirm a property account, meter, tariff, or authority to monitor.',
      ],
      nextAction: 'Resolve an address for one public location before any service-area research.',
      notes: 'Public research target only — the reported locations are not recast as buildings.',
    }),
    researchCompany({
      id: 'liss-pa',
      name: 'Liss Property Group',
      stage: 'Research',
      market: 'PA',
      headquarters: { status: 'unknown' },
      portfolioBuildings: { status: 'unknown' },
      portfolioUnits: { status: 'unknown' },
      portfolio: [
        { value: 18, label: 'communities', qualifier: 'exact', status: 'verified-public', provenanceId: lissSource.id, statement: '18 Philadelphia-area apartment communities' },
      ],
      people: [],
      provenance: [lissSource],
      researchPathways: [
        'Resolve a named community/address before checking whether a public Philadelphia annual benchmark is applicable.',
        'Portal or AMI program information is a capability reference, not confirmation of a customer account, smart meter, or reading feed.',
      ],
      nextAction: 'Source one community address and retain its public evidence before utility-path research.',
      notes: 'Public research target only — no actual water use, bill, tariff, or meter status is known.',
    }),
    researchCompany({
      id: 'gy-properties-pa',
      name: 'GY Properties',
      stage: 'Research',
      market: 'PA',
      headquarters: { status: 'unknown' },
      portfolioBuildings: { status: 'unknown' },
      portfolioUnits: { status: 'unknown' },
      portfolio: [
        { value: 60, label: 'properties', qualifier: 'exact', status: 'verified-public', provenanceId: gySource.id, statement: '60 properties' },
      ],
      people: [],
      provenance: [gySource],
      researchPathways: [
        'Resolve a specific property and preserve the source before any public benchmark or service-area review.',
        'Puma has no verified utility, tariff, smart-meter, portal, account, or client authorization record for this target.',
      ],
      nextAction: 'Resolve a public property/address and determine the appropriate official source pathway.',
      notes: 'Public research target only — no current bills, use data, alerts, or decision-maker details are stored.',
    }),
  ];

  return {
    version: 1,
    companies,
    properties: [],
    parcels: [],
    utilities: [],
    meters: [],
    tariffs: [],
    monitorSettings: {},
    updatedAt: RELEASE_RETRIEVED_AT,
  };
}

/**
 * Add only absent public seeds. Existing local records—including imported
 * client-authorized records—are never overwritten or removed by an update.
 */
export function mergeReleaseOneSeeds(workspace: Workspace): Workspace {
  const release = createReleaseOneWorkspace();
  const companyIds = new Set(workspace.companies.map((company) => company.id));
  const missingCompanies = release.companies.filter((company) => !companyIds.has(company.id));

  if (missingCompanies.length === 0) return workspace;

  return {
    ...workspace,
    companies: [...workspace.companies, ...missingCompanies],
    updatedAt: new Date().toISOString(),
  };
}
