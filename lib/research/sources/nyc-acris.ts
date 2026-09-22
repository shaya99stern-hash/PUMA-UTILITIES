import { addClaim, addEvidence, normalizeLabel, upsertEntity } from '../graph';
import type { ResearchGraph } from '../types';

const LEGALS_API = 'https://data.cityofnewyork.us/resource/8h5j-fqxa.json';
const MASTER_API = 'https://data.cityofnewyork.us/resource/bnx9-e6tj.json';
const PARTIES_API = 'https://data.cityofnewyork.us/resource/636b-3b5g.json';

const DEED_TYPES = new Set(['DEED','CORRD','DEED COR','DEED, LE','DEED, TS','DEEDO','DEEDP','IDED']);

type AcrisLegalRow = {
  document_id?: string;
  borough?: string;
  block?: string;
  lot?: string;
  street_number?: string;
  street_name?: string;
};

type AcrisMasterRow = {
  document_id?: string;
  doc_type?: string;
  document_date?: string;
  recorded_datetime?: string;
  document_amt?: string;
  crfn?: string;
};

type AcrisPartyRow = {
  document_id?: string;
  party_type?: string;
  name?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  zip?: string;
};

export type AcrisOwnershipResult = {
  bbl: { borough: string; block: string; lot: string };
  propertyAddress: string;
  deed: {
    documentId: string;
    documentType: string;
    recordedAt?: string;
    documentDate?: string;
    amount?: number;
    crfn?: string;
  };
  grantees: Array<{
    name: string;
    partyType: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  }>;
  sourceUrls: string[];
};

export async function lookupAcrisOwnershipByAddress(address: string, signal?: AbortSignal): Promise<AcrisOwnershipResult | undefined> {
  const parsed = parseStreetAddress(address);
  if (!parsed) return undefined;
  const borough = inferBoroughCode(address);
  if (borough === '5') return undefined;

  const legalUrl = new URL(LEGALS_API);
  legalUrl.searchParams.set('$select', 'document_id,borough,block,lot,street_number,street_name');
  legalUrl.searchParams.set('$where', [
    `street_number='${escapeSoql(parsed.number)}'`,
    `upper(street_name) like '%${escapeSoql(parsed.streetCore)}%'`,
    borough ? `borough=${borough}` : undefined,
  ].filter(Boolean).join(' AND '));
  legalUrl.searchParams.set('$limit', '100');
  const legals = await fetchRows<AcrisLegalRow>(legalUrl, signal);
  const exact = legals.filter((row) =>
    row.document_id && row.borough && row.block && row.lot &&
    normalizeStreetNumber(row.street_number) === normalizeStreetNumber(parsed.number) &&
    normalizeStreetName(row.street_name).includes(normalizeStreetName(parsed.streetCore))
  );
  const bbls = new Map<string, AcrisLegalRow[]>();
  for (const row of exact) {
    const key = `${row.borough}-${row.block}-${row.lot}`;
    const group = bbls.get(key) ?? [];
    group.push(row);
    bbls.set(key, group);
  }
  if (bbls.size !== 1) return undefined;
  const [bblKey, rows] = [...bbls.entries()][0];
  const [borough, block, lot] = bblKey.split('-');
  const documentIds = [...new Set(rows.map((row) => row.document_id).filter((value): value is string => Boolean(value)))].slice(0, 40);
  if (!documentIds.length) return undefined;

  const masterUrl = new URL(MASTER_API);
  masterUrl.searchParams.set('$select', 'document_id,doc_type,document_date,recorded_datetime,document_amt,crfn');
  masterUrl.searchParams.set('$where', `document_id in (${documentIds.map((id) => `'${escapeSoql(id)}'`).join(',')})`);
  masterUrl.searchParams.set('$order', 'recorded_datetime DESC');
  masterUrl.searchParams.set('$limit', '100');
  const masters = (await fetchRows<AcrisMasterRow>(masterUrl, signal))
    .filter((row) => row.document_id && row.doc_type && DEED_TYPES.has(row.doc_type.toUpperCase()))
    .sort((left, right) => timestamp(right.recorded_datetime ?? right.document_date) - timestamp(left.recorded_datetime ?? left.document_date));
  const deed = masters[0];
  if (!deed?.document_id || !deed.doc_type) return undefined;

  const partyUrl = new URL(PARTIES_API);
  partyUrl.searchParams.set('$select', 'document_id,party_type,name,address_1,address_2,city,state,zip');
  partyUrl.searchParams.set('$where', `document_id='${escapeSoql(deed.document_id)}' AND party_type='2'`);
  partyUrl.searchParams.set('$limit', '50');
  const parties = await fetchRows<AcrisPartyRow>(partyUrl, signal);
  const grantees = parties
    .filter((row) => row.party_type === '2' && row.name?.trim())
    .map((row) => ({
      name: row.name!.trim(),
      partyType: row.party_type!,
      address: [row.address_1, row.address_2].filter(Boolean).join(' ').trim() || undefined,
      city: text(row.city),
      state: text(row.state),
      zip: text(row.zip),
    }));
  if (!grantees.length) return undefined;

  const legal = rows[0];
  return {
    bbl: { borough, block, lot },
    propertyAddress: [legal.street_number, legal.street_name].filter(Boolean).join(' ').trim() || address,
    deed: {
      documentId: deed.document_id,
      documentType: deed.doc_type,
      recordedAt: text(deed.recorded_datetime),
      documentDate: text(deed.document_date),
      amount: numeric(deed.document_amt),
      crfn: text(deed.crfn),
    },
    grantees,
    sourceUrls: [legalUrl.toString(), masterUrl.toString(), partyUrl.toString()],
  };
}

export function ingestAcrisOwnership(
  graph: ResearchGraph,
  propertyId: string,
  result: AcrisOwnershipResult,
  observedAt = new Date().toISOString(),
): void {
  const property = graph.entities.find((entity) => entity.id === propertyId && entity.kind === 'property');
  if (!property) throw new Error('ACRIS ownership target property was not found.');
  const bblLabel = `BBL ${result.bbl.borough}-${result.bbl.block}-${result.bbl.lot}`;
  property.aliases = [...new Set([...(property.aliases ?? []), bblLabel])];

  const evidenceIds = result.sourceUrls.map((url, index) => {
    const evidenceId = `evidence:acris:${token(result.deed.documentId)}:${index}`;
    addEvidence(graph, {
      id: evidenceId,
      sourceId: 'nyc-acris',
      url,
      observedAt,
      authority: 'official',
      confidence: 0.97,
      excerpt: [
        bblLabel,
        result.deed.documentType,
        result.deed.recordedAt ?? result.deed.documentDate,
        result.deed.crfn ? `CRFN ${result.deed.crfn}` : undefined,
        result.grantees.map((grantee) => `grantee: ${grantee.name}`).join('; '),
      ].filter(Boolean).join(' · ').slice(0, 900),
    });
    return evidenceId;
  });

  for (const grantee of result.grantees) {
    const ownerId = `company:acris:${token(grantee.name)}`;
    upsertEntity(graph, { id: ownerId, kind: 'company', label: grantee.name, geography: 'NY' });
    addClaim(graph, {
      id: `claim:${propertyId}:owner:acris:${token(grantee.name)}`,
      subjectId: propertyId,
      fact: 'property.owner',
      objectEntityId: ownerId,
      state: 'VERIFIED',
      confidence: 0.96,
      evidenceIds,
      observedAt,
    });
    addClaim(graph, {
      id: `claim:${ownerId}:identity:acris`,
      subjectId: ownerId,
      fact: 'company.identity',
      value: grantee.name,
      state: 'SUPPORTED',
      confidence: 0.9,
      evidenceIds,
      observedAt,
    });
  }
}

function inferBoroughCode(address: string): string | undefined {
  const normalized = address.toLowerCase();
  if (/\bstaten\s+island\b/.test(normalized)) return '5';
  if (/\bbronx\b/.test(normalized)) return '2';
  if (/\bbrooklyn\b/.test(normalized)) return '3';
  if (/\bqueens\b/.test(normalized)) return '4';
  if (/\bmanhattan\b/.test(normalized) || /,\s*new\s+york\s*,\s*ny\b/.test(normalized)) return '1';
  return undefined;
}

function parseStreetAddress(address: string): { number: string; streetCore: string } | undefined {
  const street = address.split(',')[0]?.trim();
  if (!street) return undefined;
  const match = street.match(/^(\d{1,6}(?:-\d{1,6})?)\s+(.+)$/);
  if (!match) return undefined;
  const streetCore = match[2]
    .replace(/\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|place|pl|parkway|pkwy|highway|hwy|way)\.?$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  return streetCore ? { number: match[1].toUpperCase(), streetCore } : undefined;
}

async function fetchRows<T>(url: URL, signal?: AbortSignal): Promise<T[]> {
  const response = await fetch(url, {
    headers: { Accept:'application/json', 'User-Agent':'PumaUtilitiesResearch/1.3 public land-record research' },
    cache:'no-store',
    signal,
  });
  if (!response.ok) throw new Error(`NYC ACRIS Open Data returned ${response.status}.`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error('NYC ACRIS Open Data returned an unexpected response.');
  return payload as T[];
}

function normalizeStreetNumber(value?: string): string {
  return (value ?? '').toUpperCase().replace(/\s+/g, '');
}

function normalizeStreetName(value?: string): string {
  return (value ?? '').toUpperCase()
    .replace(/\b(STREET|ST|AVENUE|AVE|ROAD|RD|BOULEVARD|BLVD|DRIVE|DR|LANE|LN|COURT|CT|PLACE|PL|PARKWAY|PKWY|HIGHWAY|HWY|WAY)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function escapeSoql(value: string): string {
  return value.replace(/'/g, "''");
}

function timestamp(value?: string): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numeric(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function token(value: string): string {
  const normalized = normalizeLabel(value) || value.toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
