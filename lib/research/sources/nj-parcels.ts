const NJ_PARCEL_QUERY = 'https://maps.nj.gov/arcgis/rest/services/Applications/NJ_TaxListSearch/MapServer/2/query';

export interface NjParcelRecord {
  pamsPin?: string;
  county?: string;
  municipality?: string;
  propertyLocation?: string;
  ownerName?: string;
  mailingAddress?: string;
  cityState?: string;
  zipCode?: string;
  propertyClass?: string;
  buildingDescription?: string;
  propertyUse?: string;
  deedBook?: string;
  deedPage?: string;
  deedDate?: string;
  constructionYear?: number;
  dwellingUnits?: number;
  commercialDwellingUnits?: number;
}

export async function lookupNjParcelByPin(pin: string, signal?: AbortSignal): Promise<NjParcelRecord[]> {
  const value = pin.trim();
  if (!/^[A-Za-z0-9_.-]{3,64}$/.test(value)) throw new Error('Invalid New Jersey parcel PIN.');
  return queryParcels(`PAMS_PIN='${escapeArcgis(value)}'`, signal);
}

export async function searchNjParcelsByAddress(address: string, signal?: AbortSignal): Promise<NjParcelRecord[]> {
  const normalized = normalizeNjPropertyLocationSearch(address);
  if (normalized.length < 4 || normalized.length > 120) throw new Error('Address search must be between 4 and 120 characters.');
  return queryParcels(`PROP_LOC LIKE '%${escapeArcgis(normalized)}%'`, signal);
}

export function normalizeNjPropertyLocationSearch(address: string): string {
  const street = address.split(',')[0]?.trim() ?? '';
  return street
    .replace(/\b(?:apt|apartment|unit|suite|ste)\s*[A-Za-z0-9-]+\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

async function queryParcels(where: string, signal?: AbortSignal): Promise<NjParcelRecord[]> {
  const url = new URL(NJ_PARCEL_QUERY);
  url.searchParams.set('f', 'json');
  url.searchParams.set('where', where);
  url.searchParams.set('outFields', 'PAMS_PIN,COUNTY,MUN_NAME,PROP_LOC,OWNER_NAME,ST_ADDRESS,CITY_STATE,ZIP_CODE,PROP_CLASS,BLDG_DESC,PROP_USE,DEED_BOOK,DEED_PAGE,DEED_DATE,YR_CONSTR,DWELL,COMM_DWELL');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('resultRecordCount', '25');

  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'PumaUtilitiesResearch/1.0' },
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(`NJ parcel source returned ${response.status}.`);
  const payload = await response.json() as { features?: Array<{ attributes?: Record<string, unknown> }>; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message || 'NJ parcel source returned an error.');

  return (payload.features ?? []).map(({ attributes = {} }): NjParcelRecord => ({
    pamsPin: text(attributes.PAMS_PIN),
    county: text(attributes.COUNTY),
    municipality: text(attributes.MUN_NAME),
    propertyLocation: text(attributes.PROP_LOC),
    ownerName: text(attributes.OWNER_NAME),
    mailingAddress: text(attributes.ST_ADDRESS),
    cityState: text(attributes.CITY_STATE),
    zipCode: text(attributes.ZIP_CODE),
    propertyClass: text(attributes.PROP_CLASS),
    buildingDescription: text(attributes.BLDG_DESC),
    propertyUse: text(attributes.PROP_USE),
    deedBook: text(attributes.DEED_BOOK),
    deedPage: text(attributes.DEED_PAGE),
    deedDate: text(attributes.DEED_DATE),
    constructionYear: number(attributes.YR_CONSTR),
    dwellingUnits: number(attributes.DWELL),
    commercialDwellingUnits: number(attributes.COMM_DWELL),
  }));
}

function escapeArcgis(value: string): string {
  return value.replace(/'/g, "''");
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
