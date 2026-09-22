import { addClaim, addEvidence, normalizeLabel, upsertEntity } from '../graph';
import type { ResearchGraph } from '../types';

const BUCKS_LAYER = 'https://services3.arcgis.com/SP47Tddf7RK32lBU/arcgis/rest/services/Bucks_County_Parcels/FeatureServer/0';
const BUCKS_QUERY = BUCKS_LAYER + '/query';

export type BucksParcelRecord = {
  parcelNumber?: string;
  address?: string;
  municipality?: string;
  owner1?: string;
  owner2?: string;
  careOf?: string;
  landValue?: number;
  buildingValue?: number;
  totalValue?: number;
  landUseCode?: string;
  modifiedAt?: string;
};

export function normalizeBucksParcelStreet(address: string): string {
  return (address.split(',')[0] ?? '')
    .toUpperCase()
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
}

export function isLikelyBucksCountyAddress(address: string): boolean {
  if (!/\bPA\s+\d{5}\b/i.test(address)) return false;
  return /\b(?:Bensalem|Bristol|Chalfont|Croydon|Doylestown|Feasterville(?:-Trevose)?|Langhorne|Levittown|Morrisville|New Hope|Newtown|Perkasie|Quakertown|Richboro|Sellersville|Southampton|Warminster|Yardley)\b/i.test(address);
}

export async function lookupBucksParcelByAddress(address: string, signal?: AbortSignal): Promise<BucksParcelRecord | undefined> {
  if (!isLikelyBucksCountyAddress(address)) return undefined;
  const street = normalizeBucksParcelStreet(address);
  if (street.length < 5 || street.length > 120) return undefined;

  const url = new URL(BUCKS_QUERY);
  url.searchParams.set('f', 'json');
  url.searchParams.set('where', `ADDRESS LIKE '${escapeArcgis(street)}%'`);
  url.searchParams.set('outFields', 'PARCEL_NUM,ADDRESS,MUNICIPALITY,OWNER1,OWNER2,CARE_OF,LAND_VALUE,BUILDING_VALUE,TOTAL_VALUE,LAND_USE_CODE,MODIFY_DATE');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('resultRecordCount', '12');

  const response = await fetch(url, {
    headers: { Accept:'application/json', 'User-Agent':'PumaUtilitiesResearch/1.7 public property research' },
    cache:'no-store',
    signal,
  });
  if (!response.ok) throw new Error(`Bucks County parcels returned ${response.status}.`);
  const payload = await response.json() as { features?: Array<{ attributes?: Record<string, unknown> }>; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message || 'Bucks County parcels returned an error.');
  const rows = (payload.features ?? [])
    .map((feature) => toRecord(feature.attributes ?? {}))
    .filter((record) => normalizeBucksParcelStreet(record.address ?? '') === street);
  return rows.length === 1 ? rows[0] : undefined;
}

export function ingestBucksParcel(
  graph: ResearchGraph,
  propertyId: string,
  record: BucksParcelRecord,
  sourceUrl = BUCKS_LAYER,
  observedAt = new Date().toISOString(),
): void {
  const property = graph.entities.find((entity) => entity.id === propertyId && entity.kind === 'property');
  if (!property) throw new Error('Bucks County parcel target property was not found.');

  const parcel = record.parcelNumber?.trim();
  if (parcel) property.aliases = [...new Set([...(property.aliases ?? []), `Bucks County parcel ${parcel}`])];

  const evidenceId = `evidence:bucks-parcel:${token(parcel ?? propertyId)}`;
  addEvidence(graph, {
    id:evidenceId,
    sourceId:'bucks-county-parcels',
    url:sourceUrl,
    observedAt,
    authority:'official',
    confidence:0.96,
    excerpt:[
      parcel ? `parcel ${parcel}` : undefined,
      record.address,
      record.municipality,
      record.owner1 ? `owner: ${record.owner1}` : undefined,
      record.owner2 ? `co-owner: ${record.owner2}` : undefined,
      record.totalValue ? `assessed total value: ${record.totalValue}` : undefined,
      record.landUseCode ? `land use ${record.landUseCode}` : undefined,
    ].filter(Boolean).join(' · ').slice(0,700),
  });

  for (const ownerName of [...new Set([record.owner1, record.owner2].map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]) {
    const kind = looksLikeOrganization(ownerName) ? 'company' : 'person';
    const ownerId = `${kind}:bucks-owner:${token(ownerName)}`;
    upsertEntity(graph, { id:ownerId, kind, label:ownerName, geography:'PA' });
    addClaim(graph, {
      id:`claim:${propertyId}:owner:bucks:${token(ownerName)}`,
      subjectId:propertyId,
      fact:'property.owner',
      objectEntityId:ownerId,
      state:'VERIFIED',
      confidence:0.96,
      evidenceIds:[evidenceId],
      observedAt,
    });
  }
}

function toRecord(row: Record<string, unknown>): BucksParcelRecord {
  return {
    parcelNumber:text(row.PARCEL_NUM),
    address:text(row.ADDRESS),
    municipality:text(row.MUNICIPALITY),
    owner1:text(row.OWNER1),
    owner2:text(row.OWNER2),
    careOf:text(row.CARE_OF),
    landValue:numberValue(row.LAND_VALUE),
    buildingValue:numberValue(row.BUILDING_VALUE),
    totalValue:numberValue(row.TOTAL_VALUE),
    landUseCode:text(row.LAND_USE_CODE),
    modifiedAt:dateValue(row.MODIFY_DATE),
  };
}
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
}
function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/,/g,'')) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
function dateValue(value: unknown): string | undefined {
  const parsed = typeof value === 'number' ? new Date(value) : typeof value === 'string' ? new Date(value) : undefined;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : undefined;
}
function looksLikeOrganization(value: string): boolean {
  return /\b(LLC|L\.L\.C\.|INC|CORP|CORPORATION|CO\.?|COMPANY|LP|L\.P\.|LLP|LTD|HOLDINGS?|INVESTMENTS?|PROPERTIES|PARTNERS?|PARTNERSHIP|ASSOCIATES?|BANK|TRUST|ASSOCIATION|AUTHORITY)\b/i.test(value);
}
function escapeArcgis(value: string): string { return value.replace(/'/g, "''"); }
function token(value: string): string {
  const normalized = normalizeLabel(value) || value.toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) { hash ^= normalized.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}
