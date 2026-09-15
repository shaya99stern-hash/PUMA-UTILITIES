const CENSUS_GEOCODER = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
const EPA_WATER = 'https://services.arcgis.com/cJ9YHowT8TU7DUyn/ArcGIS/rest/services/Water_System_Boundaries/FeatureServer/0/query';
const NJ_PURVEYOR = 'https://mapsdep.nj.gov/arcgis/rest/services/Features/Utilities/MapServer/13/query';
const PA_WATER = 'https://mapservices.pasda.psu.edu/server/rest/services/pasda/DEP2/MapServer/8/query';

export interface GeocodedAddress {
  matchedAddress: string;
  longitude: number;
  latitude: number;
}

export interface WaterServiceArea {
  provider: string;
  publicWaterSystemId?: string;
  state?: string;
  ownership?: string;
  boundarySource: 'epa-national' | 'njdep' | 'padep';
  boundaryConfidence: 'authoritative' | 'modeled-or-unknown';
  agencyUrl?: string;
  reportUrl?: string;
  note?: string;
}

export async function geocodeUsAddress(address: string, signal?: AbortSignal): Promise<GeocodedAddress | undefined> {
  const normalized = address.trim().replace(/\s+/g, ' ');
  if (normalized.length < 6 || normalized.length > 180) throw new Error('Address must be 6–180 characters.');
  const url = new URL(CENSUS_GEOCODER);
  url.searchParams.set('address', normalized);
  url.searchParams.set('benchmark', 'Public_AR_Current');
  url.searchParams.set('format', 'json');
  const payload = await fetchJson<{
    result?: { addressMatches?: Array<{ matchedAddress?: string; coordinates?: { x?: number; y?: number } }> };
  }>(url, signal, 'Census geocoder');
  const match = payload.result?.addressMatches?.[0];
  const x = match?.coordinates?.x;
  const y = match?.coordinates?.y;
  if (!match?.matchedAddress || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { matchedAddress: match.matchedAddress, longitude: Number(x), latitude: Number(y) };
}

export async function resolveWaterServiceByAddress(address: string, state?: string, signal?: AbortSignal): Promise<{
  geocode?: GeocodedAddress;
  serviceAreas: WaterServiceArea[];
}> {
  const geocode = await geocodeUsAddress(address, signal);
  if (!geocode) return { serviceAreas: [] };
  const normalizedState = state?.trim().toUpperCase();
  const regional = normalizedState === 'NJ'
    ? await lookupNjPurveyors(geocode.longitude, geocode.latitude, signal)
    : normalizedState === 'PA'
      ? await lookupPaWaterSuppliers(geocode.longitude, geocode.latitude, signal)
      : [];
  const national = await lookupEpaWaterSystems(geocode.longitude, geocode.latitude, signal);
  return { geocode, serviceAreas: dedupeAreas([...regional, ...national]) };
}

export async function lookupEpaWaterSystems(longitude: number, latitude: number, signal?: AbortSignal): Promise<WaterServiceArea[]> {
  const rows = await arcgisPointQuery(EPA_WATER, longitude, latitude, '*', signal);
  return rows.map((row) => {
    const provider = firstText(row, ['PWS_NAME', 'PWSName', 'PWSNAME', 'NAME', 'PWS_NAME_1']) ?? 'Public water system';
    const sourceType = (firstText(row, ['DataProviderType', 'DATA_PROVIDER_TYPE', 'SOURCE_TYPE', 'SourceType', 'VERIFIED_TYPE']) ?? '').toLowerCase();
    const method = (firstText(row, ['Method', 'METHOD', 'ModMethod', 'MOD_METHOD', 'ModificationMethod']) ?? '').toLowerCase();
    const authoritative = /state|water utility|municipal|system|authoritative/.test(sourceType) && !/model/.test(method);
    return {
      provider,
      publicWaterSystemId: firstText(row, ['PWSID', 'PWS_ID']),
      state: firstText(row, ['STATE', 'State', 'PRIMACY_AGENCY_CODE']),
      boundarySource: 'epa-national' as const,
      boundaryConfidence: authoritative ? 'authoritative' as const : 'modeled-or-unknown' as const,
      reportUrl: firstText(row, ['DetailedFacilityReport', 'DETAILED_FACILITY_REPORT', 'ECHO_URL']),
      note: firstText(row, ['OriginalDataProvider', 'ORIGINAL_DATA_PROVIDER', 'METHOD', 'Method']),
    };
  });
}

export async function lookupNjPurveyors(longitude: number, latitude: number, signal?: AbortSignal): Promise<WaterServiceArea[]> {
  const rows = await arcgisPointQuery(NJ_PURVEYOR, longitude, latitude, 'PWID,SYS_NAME,AREA_TYPE,PWID_URL,AGENCY_URL,NOTES', signal);
  return rows.map((row) => ({
    provider: firstText(row, ['SYS_NAME']) ?? 'NJ public water purveyor',
    publicWaterSystemId: firstText(row, ['PWID']),
    state: 'NJ',
    boundarySource: 'njdep' as const,
    boundaryConfidence: 'authoritative' as const,
    reportUrl: firstText(row, ['PWID_URL']),
    agencyUrl: firstText(row, ['AGENCY_URL']),
    note: firstText(row, ['NOTES']),
  }));
}

export async function lookupPaWaterSuppliers(longitude: number, latitude: number, signal?: AbortSignal): Promise<WaterServiceArea[]> {
  const rows = await arcgisPointQuery(PA_WATER, longitude, latitude, 'NAME,PWS_ID,OWNERSHIP,CNTY_NAME,LAST_DATE', signal);
  return rows.map((row) => ({
    provider: firstText(row, ['NAME']) ?? 'PA public water supplier',
    publicWaterSystemId: firstText(row, ['PWS_ID']),
    state: 'PA',
    ownership: firstText(row, ['OWNERSHIP']),
    boundarySource: 'padep' as const,
    boundaryConfidence: 'authoritative' as const,
    note: firstText(row, ['CNTY_NAME']),
  }));
}

async function arcgisPointQuery(
  endpoint: string,
  longitude: number,
  latitude: number,
  outFields: string,
  signal?: AbortSignal,
): Promise<Array<Record<string, unknown>>> {
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error('Invalid longitude/latitude for water service lookup.');
  }
  const url = new URL(endpoint);
  url.searchParams.set('f', 'json');
  url.searchParams.set('geometry', `${longitude},${latitude}`);
  url.searchParams.set('geometryType', 'esriGeometryPoint');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outFields', outFields);
  url.searchParams.set('returnGeometry', 'false');
  const payload = await fetchJson<{ features?: Array<{ attributes?: Record<string, unknown> }>; error?: { message?: string } }>(url, signal, 'Water service GIS');
  if (payload.error) throw new Error(payload.error.message || 'Water service GIS returned an error.');
  return (payload.features ?? []).map((feature) => feature.attributes ?? {});
}

async function fetchJson<T>(url: URL, signal: AbortSignal | undefined, label: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'PumaUtilitiesResearch/1.0' },
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(`${label} returned ${response.status}.`);
  return response.json() as Promise<T>;
}

function firstText(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function dedupeAreas(areas: WaterServiceArea[]): WaterServiceArea[] {
  const seen = new Set<string>();
  return areas.filter((area) => {
    const key = `${area.publicWaterSystemId ?? ''}:${area.provider.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
