import { addClaim, addEvidence, normalizeLabel, upsertEntity } from '../graph';
import type { ResearchGraph } from '../types';

const NYS_LAYER = 'https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/FeatureServer/1';
const NYS_QUERY = NYS_LAYER + '/query';

export type NysTaxParcelRecord = {
  printKey?: string;
  sbl?: string;
  parcelAddress?: string;
  zip?: string;
  county?: string;
  municipality?: string;
  primaryOwner?: string;
  additionalOwner?: string;
  gfa?: number;
  propertyClass?: string;
  waterDescription?: string;
  rollYear?: number;
};

export function normalizeNysParcelStreet(address: string): string {
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

export async function lookupNysTaxParcelByAddress(address: string, signal?: AbortSignal): Promise<NysTaxParcelRecord | undefined> {
  if (isNycAddress(address)) return undefined;
  const street = normalizeNysParcelStreet(address);
  if (street.length < 5 || street.length > 100) return undefined;
  const zip = address.match(/\bNY\s+(\d{5})(?:-\d{4})?\b/i)?.[1];

  const safeStreet = street.replace(/['%_]/g, ' ').replace(/\s+/g, ' ').trim();
  const url = new URL(NYS_QUERY);
  url.searchParams.set('f', 'json');
  url.searchParams.set('where', `PARCEL_ADDR LIKE '${safeStreet.replace(/'/g, "''")}%'`);
  url.searchParams.set('outFields', 'COUNTY_NAME,MUNI_NAME,PARCEL_ADDR,PRINT_KEY,SBL,LOC_ZIP,PROP_CLASS,GFA,WATER_DESC,ROLL_YR,PRIMARY_OWNER,ADD_OWNER');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('resultRecordCount', '12');

  const response = await fetch(url, {
    headers:{ Accept:'application/json', 'User-Agent':'PumaUtilitiesResearch/1.6 public property research' },
    cache:'no-store',
    signal,
  });
  if (!response.ok) throw new Error(`NYS tax parcels returned ${response.status}.`);
  const payload = await response.json() as { features?: Array<{ attributes?: Record<string, unknown> }>; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message || 'NYS tax parcels returned an error.');

  const records = (payload.features ?? []).map((feature) => toRecord(feature.attributes ?? {}))
    .filter((record) => normalizeNysParcelStreet(record.parcelAddress ?? '') === street)
    .filter((record) => !zip || !record.zip || record.zip.slice(0,5) === zip);

  return records.length === 1 ? records[0] : undefined;
}

export function ingestNysTaxParcel(
  graph: ResearchGraph,
  propertyId: string,
  record: NysTaxParcelRecord,
  sourceUrl = NYS_LAYER,
  observedAt = new Date().toISOString(),
): void {
  const property = graph.entities.find((entity) => entity.id === propertyId && entity.kind === 'property');
  if (!property) throw new Error('NYS tax parcel target property was not found.');

  const parcelKey = record.printKey?.trim() || record.sbl?.trim();
  if (parcelKey) property.aliases = [...new Set([...(property.aliases ?? []), `NYS tax parcel ${parcelKey}`])];

  const evidenceId = `evidence:nys-parcel:${token(parcelKey ?? propertyId)}`;
  addEvidence(graph, {
    id:evidenceId,
    sourceId:'nys-tax-parcels-public',
    url:sourceUrl,
    observedAt,
    authority:'official',
    confidence:0.94,
    excerpt:[
      parcelKey ? `parcel ${parcelKey}` : undefined,
      record.parcelAddress,
      record.county ? `${record.county} County` : undefined,
      record.primaryOwner ? `owner: ${record.primaryOwner}` : undefined,
      record.additionalOwner ? `additional owner: ${record.additionalOwner}` : undefined,
      record.gfa ? `GFA: ${record.gfa}` : undefined,
      record.propertyClass ? `class ${record.propertyClass}` : undefined,
      record.waterDescription ? `water: ${record.waterDescription}` : undefined,
      record.rollYear ? `roll year ${record.rollYear}` : undefined,
    ].filter(Boolean).join(' · ').slice(0,700),
  });

  for (const ownerName of [...new Set([record.primaryOwner, record.additionalOwner].map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]) {
    const kind = looksLikeOrganization(ownerName) ? 'company' : 'person';
    const ownerId = `${kind}:nys-owner:${token(ownerName)}`;
    upsertEntity(graph, { id:ownerId, kind, label:ownerName, geography:'NY' });
    addClaim(graph, {
      id:`claim:${propertyId}:owner:nys:${token(ownerName)}`,
      subjectId:propertyId,
      fact:'property.owner',
      objectEntityId:ownerId,
      state:'VERIFIED',
      confidence:0.94,
      evidenceIds:[evidenceId],
      observedAt,
    });
  }

  if (typeof record.gfa === 'number' && Number.isFinite(record.gfa) && record.gfa > 0 && record.gfa <= 500_000_000) {
    addClaim(graph, {
      id:`claim:${propertyId}:gross-area:nys:${token(parcelKey ?? propertyId)}`,
      subjectId:propertyId,
      fact:'property.grossSquareFeet',
      value:Math.round(record.gfa),
      state:'VERIFIED',
      confidence:0.91,
      evidenceIds:[evidenceId],
      observedAt,
    });
  }
}

function isNycAddress(address: string): boolean {
  if (/\b(?:new york|manhattan|brooklyn|bronx|queens|staten island)\b/i.test(address)) return true;
  const zip = address.match(/\bNY\s+(\d{5})(?:-\d{4})?\b/i)?.[1];
  const value = zip ? Number(zip) : NaN;
  return Number.isFinite(value) && (
    (value >= 10001 && value <= 10282) ||
    (value >= 10301 && value <= 10475) ||
    (value >= 11004 && value <= 11005) ||
    (value >= 11101 && value <= 11697)
  );
}

function toRecord(row: Record<string, unknown>): NysTaxParcelRecord {
  return {
    printKey:text(row.PRINT_KEY),
    sbl:text(row.SBL),
    parcelAddress:text(row.PARCEL_ADDR),
    zip:text(row.LOC_ZIP),
    county:text(row.COUNTY_NAME),
    municipality:text(row.MUNI_NAME),
    primaryOwner:text(row.PRIMARY_OWNER),
    additionalOwner:text(row.ADD_OWNER),
    gfa:numberValue(row.GFA),
    propertyClass:text(row.PROP_CLASS),
    waterDescription:text(row.WATER_DESC),
    rollYear:numberValue(row.ROLL_YR),
  };
}
function text(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}
function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/,/g,'')) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
function looksLikeOrganization(value: string): boolean {
  return /\b(LLC|L\.L\.C\.|INC|CORP|CORPORATION|CO\.?|COMPANY|LP|L\.P\.|LLP|LTD|HOLDINGS?|INVESTMENTS?|PROPERTIES|PARTNERS?|PARTNERSHIP|ASSOCIATES?|BANK|TRUST|ASSOCIATION|AUTHORITY)\b/i.test(value);
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
