import { addClaim, addEvidence, normalizeLabel, upsertEntity } from '../graph';
import type { ResearchGraph } from '../types';

export type SupportedPaCounty = 'Bucks' | 'Montgomery' | 'Chester' | 'Delaware';

export type PaCountyParcelRecord = {
  county: SupportedPaCounty;
  parcelNumber?: string;
  address?: string;
  municipality?: string;
  owner1?: string;
  owner2?: string;
  residentialUnits?: number;
  assessedValue?: number;
  sourceUrl: string;
  sourceYear?: number;
};

const SOURCES = {
  Bucks: 'https://services3.arcgis.com/SP47Tddf7RK32lBU/arcgis/rest/services/Bucks_County_Parcels/FeatureServer/0',
  Montgomery: 'https://services1.arcgis.com/kOChldNuKsox8qZD/arcgis/rest/services/Montgomery_County_Parcels/FeatureServer/6',
  Chester: 'https://services.arcgis.com/G4S1dGvn7PIgYd6Y/arcgis/rest/services/Parcels_owners/FeatureServer/0',
  Delaware: 'https://gis.delcopa.gov/arcgis/rest/services/Hosted/Delaware_County_Parcel_319_Project/FeatureServer/0',
} as const;

export function normalizePaCountyParcelStreet(address: string): string {
  return (address.split(',')[0] ?? '')
    .toUpperCase()
    .replace(/\b(?:APT|APARTMENT|UNIT|SUITE|STE)\s*[A-Z0-9-]+\b/g, ' ')
    .replace(/[.]/g, '')
    .replace(/\bNORTH\b/g, 'N').replace(/\bSOUTH\b/g, 'S').replace(/\bEAST\b/g, 'E').replace(/\bWEST\b/g, 'W')
    .replace(/\bSTREET\b/g, 'ST').replace(/\bAVENUE\b/g, 'AVE').replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bROAD\b/g, 'RD').replace(/\bDRIVE\b/g, 'DR').replace(/\bLANE\b/g, 'LN').replace(/\bCOURT\b/g, 'CT')
    .replace(/\bPLACE\b/g, 'PL').replace(/\bPARKWAY\b/g, 'PKWY').replace(/\bHIGHWAY\b/g, 'HWY')
    .replace(/\s+/g, ' ').trim();
}

export function supportedPaCountyForAddress(address: string): SupportedPaCounty | undefined {
  if (!/\bPA\b/i.test(address)) return undefined;
  if (/\b(?:Bensalem|Bristol|Buckingham|Chalfont|Churchville|Croydon|Doylestown|Dublin|Fairless Hills|Feasterville(?:-Trevose)?|Furlong|Jamison|Langhorne|Levittown|Morrisville|New Hope|Newtown|Penndel|Perkasie|Quakertown|Richboro|Southampton|Trevose|Warminster|Warrington|Yardley)\b/i.test(address)) return 'Bucks';
  if (/\b(?:Norristown|King of Prussia|Pottstown|Lansdale|Conshohocken|Ambler|Blue Bell|Plymouth Meeting|Willow Grove|Jenkintown|Hatboro|Collegeville|Royersford|Harleysville|Horsham|North Wales|Fort Washington|Glenside)\b/i.test(address)) return 'Montgomery';
  if (/\b(?:West Chester|Exton|Downingtown|Coatesville|Kennett Square|Oxford|Malvern|Phoenixville|Avondale|Berwyn|Devon|Paoli|Thorndale|West Grove|Honey Brook)\b/i.test(address)) return 'Chester';
  if (/\b(?:Media|Upper Darby|Drexel Hill|Havertown|Springfield|Ridley Park|Lansdowne|Swarthmore|Aston|Glen Mills|Brookhaven|Clifton Heights|Collingdale|Darby|Folcroft|Morton|Prospect Park|Radnor|Wayne|Chester)\b/i.test(address)) return 'Delaware';
  return undefined;
}

export function isLikelySupportedPaCountyAddress(address: string): boolean {
  return Boolean(supportedPaCountyForAddress(address));
}

export async function lookupPaCountyParcelByAddress(address: string, signal?: AbortSignal): Promise<PaCountyParcelRecord | undefined> {
  const county = supportedPaCountyForAddress(address);
  if (!county) return undefined;
  const street = normalizePaCountyParcelStreet(address);
  if (street.length < 5 || street.length > 120) return undefined;
  if (county === 'Bucks') return queryBucks(street, signal);
  if (county === 'Montgomery') return queryMontgomery(street, signal);
  if (county === 'Chester') return queryChester(street, signal);
  return queryDelaware(street, signal);
}

export function ingestPaCountyParcel(graph: ResearchGraph, propertyId: string, record: PaCountyParcelRecord, observedAt = new Date().toISOString()): void {
  const property = graph.entities.find((entity) => entity.id === propertyId && entity.kind === 'property');
  if (!property) throw new Error('Pennsylvania county parcel target property was not found.');
  const parcel = record.parcelNumber?.trim();
  if (parcel) property.aliases = [...new Set([...(property.aliases ?? []), `${record.county} County parcel ${parcel}`])];
  const evidenceId = `evidence:pa-county:${token(record.county + ':' + (parcel ?? propertyId))}`;
  addEvidence(graph, {
    id:evidenceId,
    sourceId:'pa-county-assessment',
    url:record.sourceUrl,
    observedAt,
    authority:'official',
    confidence:0.95,
    excerpt:[
      parcel ? `${record.county} parcel ${parcel}` : `${record.county} County parcel`,
      record.address,
      record.municipality,
      record.owner1 ? `owner: ${record.owner1}` : undefined,
      record.owner2 ? `co-owner: ${record.owner2}` : undefined,
      record.residentialUnits ? `${record.residentialUnits} residential units` : undefined,
      record.assessedValue !== undefined ? `assessed value: ${record.assessedValue}` : undefined,
      record.sourceYear ? `tax year ${record.sourceYear}` : undefined,
    ].filter(Boolean).join(' · ').slice(0,700),
  });

  for (const ownerName of [...new Set([record.owner1, record.owner2].map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]) {
    const kind = looksLikeOrganization(ownerName) ? 'company' : 'person';
    const ownerId = `${kind}:pa-county:${token(record.county + ':' + ownerName)}`;
    upsertEntity(graph, { id:ownerId, kind, label:ownerName, geography:'PA' });
    addClaim(graph, { id:`claim:${propertyId}:owner:pa-county:${token(record.county + ':' + ownerName)}`, subjectId:propertyId, fact:'property.owner', objectEntityId:ownerId, state:'VERIFIED', confidence:0.95, evidenceIds:[evidenceId], observedAt });
  }

  if (record.county === 'Montgomery' && typeof record.residentialUnits === 'number' && Number.isInteger(record.residentialUnits) && record.residentialUnits > 0 && record.residentialUnits <= 20_000) {
    addClaim(graph, { id:`claim:${propertyId}:units:montgomery:${token(parcel ?? propertyId)}`, subjectId:propertyId, fact:'property.units', value:record.residentialUnits, state:'VERIFIED', confidence:0.94, evidenceIds:[evidenceId], observedAt });
  }
}

async function queryBucks(street: string, signal?: AbortSignal): Promise<PaCountyParcelRecord | undefined> {
  return queryLayer('Bucks', SOURCES.Bucks, 'ADDRESS', street, 'PARCEL_NUM,ADDRESS,MUNICIPALITY,OWNER1,OWNER2,TOTAL_VALUE', (row) => ({
    county:'Bucks', parcelNumber:text(row.PARCEL_NUM), address:text(row.ADDRESS), municipality:text(row.MUNICIPALITY), owner1:text(row.OWNER1), owner2:text(row.OWNER2), assessedValue:numberValue(row.TOTAL_VALUE), sourceUrl:SOURCES.Bucks,
  }), signal);
}

async function queryMontgomery(street: string, signal?: AbortSignal): Promise<PaCountyParcelRecord | undefined> {
  return queryLayer('Montgomery', SOURCES.Montgomery, 'LOCATION1', street, 'TAXPIN,LOCATION1,Muni_Name,OWN1,OWN2,LIV_UNITS,TOTAL_APPR', (row) => ({
    county:'Montgomery', parcelNumber:text(row.TAXPIN), address:text(row.LOCATION1), municipality:text(row.Muni_Name), owner1:text(row.OWN1), owner2:text(row.OWN2), residentialUnits:positiveInteger(row.LIV_UNITS), assessedValue:numberValue(row.TOTAL_APPR), sourceUrl:SOURCES.Montgomery,
  }), signal);
}

async function queryChester(street: string, signal?: AbortSignal): Promise<PaCountyParcelRecord | undefined> {
  return queryLayer('Chester', SOURCES.Chester, 'LOC_ADDRESS', street, 'UPI,PIN_MAP,LOC_ADDRESS,OWN1,OWN2,TAXYR', (row) => ({
    county:'Chester', parcelNumber:text(row.UPI) ?? text(row.PIN_MAP), address:text(row.LOC_ADDRESS), owner1:text(row.OWN1), owner2:text(row.OWN2), sourceYear:positiveInteger(row.TAXYR), sourceUrl:SOURCES.Chester,
  }), signal);
}

async function queryDelaware(street: string, signal?: AbortSignal): Promise<PaCountyParcelRecord | undefined> {
  return queryLayer('Delaware', SOURCES.Delaware, 'adrcat', street, 'pin,parid,altid,adrcat,own1,own2,taxyr', (row) => ({
    county:'Delaware', parcelNumber:text(row.pin) ?? text(row.parid) ?? text(row.altid), address:text(row.adrcat), owner1:text(row.own1), owner2:text(row.own2), sourceYear:positiveInteger(row.taxyr), sourceUrl:SOURCES.Delaware,
  }), signal);
}

async function queryLayer(
  county: SupportedPaCounty,
  layer: string,
  addressField: string,
  street: string,
  outFields: string,
  mapper: (row: Record<string, unknown>) => PaCountyParcelRecord,
  signal?: AbortSignal,
): Promise<PaCountyParcelRecord | undefined> {
  const url = new URL(layer + '/query');
  url.searchParams.set('f','json');
  url.searchParams.set('where', `${addressField} LIKE '${escapeArcgis(street)}%'`);
  url.searchParams.set('outFields', outFields);
  url.searchParams.set('returnGeometry','false');
  url.searchParams.set('resultRecordCount','12');
  const response = await fetch(url, { headers:{ Accept:'application/json', 'User-Agent':'PumaUtilitiesResearch/1.8 public property research' }, cache:'no-store', signal });
  if (!response.ok) throw new Error(`${county} County parcels returned ${response.status}.`);
  const payload = await response.json() as { features?: Array<{ attributes?: Record<string, unknown> }>; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message || `${county} County parcels returned an error.`);
  const rows = (payload.features ?? []).map((feature) => mapper(feature.attributes ?? {})).filter((record) => normalizePaCountyParcelStreet(record.address ?? '') === street);
  return rows.length === 1 ? rows[0] : undefined;
}

function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined; }
function numberValue(value: unknown): number | undefined { const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/,/g,'')) : NaN; return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined; }
function positiveInteger(value: unknown): number | undefined { const parsed = numberValue(value); return parsed !== undefined && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined; }
function looksLikeOrganization(value: string): boolean { return /\b(LLC|L\.L\.C\.|INC|CORP|CORPORATION|CO\.?|COMPANY|LP|L\.P\.|LLP|LTD|HOLDINGS?|INVESTMENTS?|PROPERTIES|PARTNERS?|PARTNERSHIP|ASSOCIATES?|BANK|TRUST|ASSOCIATION|AUTHORITY)\b/i.test(value); }
function escapeArcgis(value: string): string { return value.replace(/'/g,"''"); }
function token(value: string): string { const normalized = normalizeLabel(value) || value.toLowerCase(); let hash = 2166136261; for (let index = 0; index < normalized.length; index += 1) { hash ^= normalized.charCodeAt(index); hash = Math.imul(hash,16777619); } return (hash >>> 0).toString(36); }
