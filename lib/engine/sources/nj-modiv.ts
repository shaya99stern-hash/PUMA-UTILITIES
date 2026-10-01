/**
 * NJ MOD-IV statewide tax list (NJGIN Parcels_MOD4). Class 4C = apartments.
 * Owner names are redacted statewide (Daniel's Law) but owner MAILING addresses remain, so the
 * engine clusters parcels by mailing address and resolves the company behind the address elsewhere.
 */
import { mailingKey, parseNjUnits, splitCityState, streetKey, titleCase, toInt, toNumber, trimOrNull, validYear, zip5 } from '../text';
import type { PropertyRecord, SourceInfo } from '../types';
import { arcgisQuery, chunk, provenance, ringCentroid, sqlLit, type FetchCtx } from './common';

export const njModiv: SourceInfo = {
  id: 'nj-modiv',
  name: 'NJ MOD-IV Tax List (NJGIN)',
  kind: 'discovery',
  coverage: ['NJ'],
  coverageLabel: 'New Jersey (statewide)',
  capabilities: ['buildings', 'units', 'year_built', 'owner_mailing_address', 'assessed_value', 'coordinates'],
  description: 'Statewide parcel tax list: apartment parcels (class 4C), unit counts, year built, assessed value and owner mailing address.',
  homepage: 'https://njgin.nj.gov/njgin/edata/parcels/',
  verified: 'live',
};

export const NJ_LAYER = 'https://maps.nj.gov/arcgis/rest/services/Applications/NJ_TaxListSearch/MapServer/2';
const FIELDS = 'PAMS_PIN,PROP_CLASS,COUNTY,MUN_NAME,PROP_LOC,OWNER_NAME,ST_ADDRESS,CITY_STATE,ZIP_CODE,BLDG_DESC,YR_CONSTR,DWELL,NET_VALUE,CALC_ACRE';

export const NJ_COUNTIES = ['ATLANTIC', 'BERGEN', 'BURLINGTON', 'CAMDEN', 'CAPE MAY', 'CUMBERLAND', 'ESSEX', 'GLOUCESTER', 'HUDSON', 'HUNTERDON', 'MERCER', 'MIDDLESEX', 'MONMOUTH', 'MORRIS', 'OCEAN', 'PASSAIC', 'SALEM', 'SOMERSET', 'SUSSEX', 'UNION', 'WARREN'];

export function njCountiesFor(values: string[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    const u = v.toUpperCase().replace(/\bCOUNTY\b/g, '').replace(/\s+/g, ' ').trim();
    if (NJ_COUNTIES.includes(u)) out.add(u);
  }
  return [...out];
}

export function njCity(munName: string | null | undefined): string | null {
  const v = (munName ?? '').toUpperCase().replace(/\b(CITY|TWP|TOWNSHIP|BORO|BOROUGH|TOWN|VILLAGE)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return v ? titleCase(v) : null;
}

/** Unit count: BLDG_DESC "nnU" first, then DWELL (>1), else an assessed-value estimate. */
export function njUnits(bldgDesc: unknown, dwell: unknown, netValue: unknown): { units: number | null; estimated: boolean } {
  const fromDesc = parseNjUnits(String(bldgDesc ?? ''));
  if (fromDesc) return { units: fromDesc, estimated: false };
  const d = toInt(dwell);
  if (d && d > 1) return { units: d, estimated: false };
  const value = toNumber(netValue);
  if (value && value > 750_000) return { units: Math.max(5, Math.round(value / 150_000)), estimated: true };
  return { units: d && d > 0 ? Math.max(5, d) : 5, estimated: true };
}

export function parseNjFeatures(features: { attributes: Record<string, unknown>; geometry?: { rings?: number[][][] } }[], url: string): PropertyRecord[] {
  const prov = provenance(njModiv, url);
  return features.flatMap(({ attributes: a, geometry }) => {
    const pin = trimOrNull(a.PAMS_PIN);
    const loc = trimOrNull(a.PROP_LOC);
    if (!pin || !loc) return [];
    const street = trimOrNull(a.ST_ADDRESS);
    const cs = splitCityState(trimOrNull(a.CITY_STATE));
    const mailZip = zip5(trimOrNull(a.ZIP_CODE));
    const units = njUnits(a.BLDG_DESC, a.DWELL, a.NET_VALUE);
    const centroid = ringCentroid(geometry?.rings);
    const owner = trimOrNull(a.OWNER_NAME);
    const city = njCity(trimOrNull(a.MUN_NAME));
    return [{
      sourceKey: `nj-pin:${pin}`,
      altKeys: [`addr:${streetKey(loc)}|${(city ?? '').toUpperCase()}`],
      address: titleCase(loc),
      city,
      state: 'NJ',
      zip: null,
      county: a.COUNTY ? titleCase(String(a.COUNTY)) : null,
      lat: centroid?.lat ?? null,
      lon: centroid?.lon ?? null,
      units: units.units,
      unitsEstimated: units.estimated,
      yearBuilt: validYear(a.YR_CONSTR),
      buildingClass: '4C',
      assessedValue: toNumber(a.NET_VALUE),
      parcelId: pin,
      ownerName: owner && owner.length > 2 ? owner : null,
      ownerMailingAddress: street ? `${titleCase(street)}, ${cs.city ?? ''}${cs.state ? ` ${cs.state}` : ''} ${mailZip ?? ''}`.replace(/\s+/g, ' ').trim() : null,
      mailingKey: mailingKey(street, cs.city, mailZip),
      provenance: prov,
      extra: { bldgDesc: trimOrNull(a.BLDG_DESC), mailCity: cs.city, mailState: cs.state, mailZip, mailStreet: street },
    }];
  });
}

export type NjQuery = { county: string; municipality?: string | null };

export function njWhere(q: NjQuery): string {
  const parts = [`PROP_CLASS='4C'`, `COUNTY=${sqlLit(q.county.toUpperCase())}`];
  if (q.municipality) parts.push(`MUN_NAME LIKE ${sqlLit(`${q.municipality.toUpperCase()}%`)}`);
  return parts.join(' AND ');
}

export async function fetchNjParcels(q: NjQuery, page: { offset: number; limit: number }, ctx: FetchCtx) {
  const { features, exceeded, url } = await arcgisQuery(njModiv, NJ_LAYER, {
    where: njWhere(q),
    outFields: FIELDS,
    returnGeometry: false,
    orderByFields: 'PAMS_PIN',
    resultOffset: page.offset,
    resultRecordCount: Math.min(1000, page.limit),
  }, ctx, { ttlMs: 7 * 24 * 3_600_000, timeoutMs: 25_000 });
  return { records: parseNjFeatures(features, url), raw: features.length, exceeded, url };
}

/** Parcel centroids (WGS84) for a few PINs, for utility lookups. */
export async function fetchNjCentroids(pins: string[], ctx: FetchCtx) {
  const out = new Map<string, { lat: number; lon: number }>();
  for (const group of chunk(pins, 50)) {
    const { features } = await arcgisQuery<{ PAMS_PIN: string }>(njModiv, NJ_LAYER, {
      where: `PAMS_PIN IN (${group.map(sqlLit).join(',')})`,
      outFields: 'PAMS_PIN',
      returnGeometry: true,
      outSR: 4326,
      geometryPrecision: 5,
      maxAllowableOffset: 0.0005,
    }, ctx, { ttlMs: 30 * 24 * 3_600_000 });
    for (const f of features) {
      const c = ringCentroid(f.geometry?.rings);
      if (c && f.attributes.PAMS_PIN) out.set(f.attributes.PAMS_PIN, c);
    }
  }
  return out;
}

/** All 4C parcels mailed to a given street address (used to enrich a company with a known address). */
export async function fetchNjParcelsByMailing(street: string, ctx: FetchCtx) {
  const s = street.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(\d+[A-Z]?)\s+(\S+)/);
  if (!m) return { records: [] as PropertyRecord[], url: '' };
  const { features, url } = await arcgisQuery(njModiv, NJ_LAYER, {
    where: `PROP_CLASS='4C' AND ST_ADDRESS LIKE ${sqlLit(`${m[1]} ${m[2]}%`)}`,
    outFields: FIELDS,
    returnGeometry: false,
    resultRecordCount: 1000,
  }, ctx);
  return { records: parseNjFeatures(features, url), url };
}
