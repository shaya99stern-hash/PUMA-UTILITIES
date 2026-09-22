import { addClaim, addEvidence, normalizeLabel, upsertEntity } from '../graph';
import type { ResearchGraph } from '../types';

const OPA_LAYER = 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/OPA_PROPERTIES_PUBLIC/FeatureServer/0';
const OPA_QUERY = OPA_LAYER + '/query';

export type PhiladelphiaOpaRecord = {
  parcelNumber?: string;
  location?: string;
  owner1?: string;
  owner2?: string;
  totalLivableArea?: number;
};

export function normalizePhiladelphiaStreetAddress(address: string): string {
  let street = address.split(',')[0]?.trim().toUpperCase() ?? '';
  street = street
    .replace(/\b(?:APT|APARTMENT|UNIT|SUITE|STE)\s+[A-Z0-9-]+\b/g, ' ')
    .replace(/[.]/g, '')
    .replace(/\bSTREET\b/g, 'ST')
    .replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bROAD\b/g, 'RD')
    .replace(/\bDRIVE\b/g, 'DR')
    .replace(/\bLANE\b/g, 'LN')
    .replace(/\bCOURT\b/g, 'CT')
    .replace(/\bPLACE\b/g, 'PL')
    .replace(/\bPARKWAY\b/g, 'PKWY')
    .replace(/\bHIGHWAY\b/g, 'HWY')
    .replace(/\s+/g, ' ')
    .trim();
  return street;
}

export async function lookupPhiladelphiaOpaByAddress(address: string, signal?: AbortSignal): Promise<PhiladelphiaOpaRecord | undefined> {
  if (!/\bphiladelphia\b/i.test(address)) return undefined;
  const street = normalizePhiladelphiaStreetAddress(address);
  if (street.length < 5 || street.length > 80) return undefined;

  const url = new URL(OPA_QUERY);
  url.searchParams.set('f', 'json');
  url.searchParams.set('where', `location LIKE '${escapeArcgis(street)}%'`);
  url.searchParams.set('outFields', 'parcel_number,location,owner_1,owner_2,total_livable_area');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('resultRecordCount', '10');

  const response = await fetch(url, {
    headers: { Accept:'application/json', 'User-Agent':'PumaUtilitiesResearch/1.5 public property research' },
    cache:'no-store',
    signal,
  });
  if (!response.ok) throw new Error(`Philadelphia OPA returned ${response.status}.`);
  const payload = await response.json() as {
    features?: Array<{ attributes?: Record<string, unknown> }>;
    error?: { message?: string };
  };
  if (payload.error) throw new Error(payload.error.message || 'Philadelphia OPA returned an error.');
  const records = (payload.features ?? [])
    .map((feature) => toRecord(feature.attributes ?? {}))
    .filter((record) => normalizePhiladelphiaStreetAddress(record.location ?? '') === street);
  return records.length === 1 ? records[0] : undefined;
}

export function ingestPhiladelphiaOpa(
  graph: ResearchGraph,
  propertyId: string,
  record: PhiladelphiaOpaRecord,
  sourceUrl = OPA_LAYER,
  observedAt = new Date().toISOString(),
): void {
  const property = graph.entities.find((entity) => entity.id === propertyId && entity.kind === 'property');
  if (!property) throw new Error('Philadelphia OPA target property was not found.');

  const parcel = record.parcelNumber?.trim();
  if (parcel) property.aliases = [...new Set([...(property.aliases ?? []), `Philadelphia OPA ${parcel}`])];

  const evidenceId = `evidence:phila-opa:${token(parcel ?? propertyId)}`;
  addEvidence(graph, {
    id:evidenceId,
    sourceId:'phila-opa-properties',
    url:sourceUrl,
    observedAt,
    authority:'official',
    confidence:0.96,
    excerpt:[
      parcel ? `OPA ${parcel}` : undefined,
      record.location,
      record.owner1 ? `owner: ${record.owner1}` : undefined,
      record.owner2 ? `co-owner: ${record.owner2}` : undefined,
      record.totalLivableArea ? `reported total livable area: ${record.totalLivableArea}` : undefined,
    ].filter(Boolean).join(' · ').slice(0,700),
  });

  for (const ownerName of [...new Set([record.owner1, record.owner2].map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]) {
    const kind = looksLikeOrganization(ownerName) ? 'company' : 'person';
    const ownerId = `${kind}:phila-opa:${token(ownerName)}`;
    upsertEntity(graph, { id:ownerId, kind, label:ownerName, geography:'PA' });
    addClaim(graph, {
      id:`claim:${propertyId}:owner:phila-opa:${token(ownerName)}`,
      subjectId:propertyId,
      fact:'property.owner',
      objectEntityId:ownerId,
      state:'VERIFIED',
      confidence:0.95,
      evidenceIds:[evidenceId],
      observedAt,
    });
  }
}

function toRecord(row: Record<string, unknown>): PhiladelphiaOpaRecord {
  return {
    parcelNumber:text(row.parcel_number),
    location:text(row.location),
    owner1:text(row.owner_1),
    owner2:text(row.owner_2),
    totalLivableArea:numberValue(row.total_livable_area),
  };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/,/g,'')) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function looksLikeOrganization(value: string): boolean {
  return /\b(LLC|L\.L\.C\.|INC|CORP|CORPORATION|CO\.?|COMPANY|LP|L\.P\.|LLP|LTD|HOLDINGS?|INVESTMENTS?|PROPERTIES|PARTNERS?|PARTNERSHIP|ASSOCIATES?|BANK|TRUST|ASSOCIATION|AUTHORITY)\b/i.test(value);
}

function escapeArcgis(value: string): string {
  return value.replace(/'/g, "''");
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
