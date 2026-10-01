/** Philadelphia Office of Property Assessment (OPA_PROPERTIES_PUBLIC): apartment parcels with owner + mailing address. */
import { isGenericName, mailingKey, opaUnitEstimate, parseCareOf, splitCityState, streetKey, titleCase, toInt, toNumber, trimOrNull, validYear, zip5 } from '../text';
import type { PropertyRecord, SourceInfo } from '../types';
import { arcgisQuery, provenance, sqlLit, type FetchCtx } from './common';

export const phlOpa: SourceInfo = {
  id: 'phl-opa',
  name: 'Philadelphia OPA Property Assessments',
  kind: 'discovery',
  coverage: ['PA'],
  coverageLabel: 'Philadelphia',
  capabilities: ['buildings', 'unit_band', 'year_built', 'owner_of_record', 'owner_mailing_address', 'care_of_manager', 'coordinates'],
  description: 'Every Philadelphia parcel: owner of record, mailing / care-of address, building code (unit band), year built and market value.',
  homepage: 'https://opendataphilly.org/datasets/philadelphia-properties-and-current-assessments/',
  verified: 'live',
};

export const OPA_LAYER = 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/OPA_PROPERTIES_PUBLIC/FeatureServer/0';
const FIELDS = 'parcel_number,location,owner_1,owner_2,mailing_street,mailing_address_1,mailing_care_of,mailing_city_state,mailing_zip,building_code_description,category_code_description,year_built,number_stories,market_value,total_livable_area,zip_code';

export type OpaQuery = { zips?: string[]; minBand?: 5 | 51 | 100; ownerLike?: string[] };

export function opaWhere(q: OpaQuery): string {
  const bands = q.minBand === 100 ? [`building_code_description LIKE 'APTS 100+%'`] : q.minBand === 51 ? [`building_code_description LIKE 'APTS 100+%'`, `building_code_description LIKE 'APTS 51-100%'`] : [`building_code_description LIKE 'APTS%'`];
  const parts = [`(${bands.join(' OR ')})`, `category_code_description IN ('APARTMENTS  > 4 UNITS','MULTI FAMILY','MIXED USE','COMMERCIAL')`];
  if (q.zips?.length) parts.push(`zip_code IN (${q.zips.map(sqlLit).join(',')})`);
  if (q.ownerLike?.length) parts.push(`(${q.ownerLike.map((k) => `UPPER(owner_1) LIKE ${sqlLit(`%${k.toUpperCase()}%`)}`).join(' OR ')})`);
  return parts.join(' AND ');
}

export function parseOpaFeatures(features: { attributes: Record<string, unknown>; geometry?: { x?: number; y?: number } }[], url: string): PropertyRecord[] {
  const prov = provenance(phlOpa, url);
  return features.flatMap(({ attributes: a, geometry }) => {
    const parcel = trimOrNull(a.parcel_number);
    const location = trimOrNull(a.location);
    if (!parcel || !location) return [];
    const careOf = parseCareOf(trimOrNull(a.mailing_street));
    const careName = trimOrNull(a.mailing_care_of) ?? careOf.careOf;
    const mailStreet = careOf.street || trimOrNull(a.mailing_street);
    const cs = splitCityState(trimOrNull(a.mailing_city_state));
    const mzip = zip5(trimOrNull(a.mailing_zip));
    const units = opaUnitEstimate(trimOrNull(a.building_code_description), toNumber(a.total_livable_area));
    const owner = [trimOrNull(a.owner_1), trimOrNull(a.owner_2)].filter((x): x is string => !!x && !isGenericName(x));
    const zip = zip5(trimOrNull(a.zip_code));
    return [{
      sourceKey: `phl-opa:${parcel}`,
      altKeys: zip ? [`addr:${streetKey(location)}|${zip}`] : [],
      address: titleCase(location),
      city: 'Philadelphia',
      state: 'PA',
      zip,
      county: 'Philadelphia',
      lat: typeof geometry?.y === 'number' ? geometry.y : null,
      lon: typeof geometry?.x === 'number' ? geometry.x : null,
      units: units.units,
      unitsEstimated: units.estimated,
      yearBuilt: validYear(a.year_built),
      stories: toInt(a.number_stories),
      buildingClass: trimOrNull(a.building_code_description),
      grossSqft: toInt(a.total_livable_area),
      assessedValue: toNumber(a.market_value),
      parcelId: parcel,
      ownerName: owner[0] ?? null,
      ownerMailingAddress: mailStreet ? `${titleCase(mailStreet)}, ${cs.city ?? ''}${cs.state ? ` ${cs.state}` : ''} ${mzip ?? ''}`.replace(/\s+/g, ' ').trim() : null,
      mailingKey: mailingKey(mailStreet, cs.city, mzip),
      managerName: careName && !isGenericName(careName) && !/E-?RECORDING|SIMPLIFILE|TAX DEPT|ATTN/i.test(careName) ? careName : null,
      provenance: prov,
      extra: { owner2: owner[1] ?? null, mailingAddress1: trimOrNull(a.mailing_address_1) },
    }];
  });
}

export async function fetchOpaParcels(q: OpaQuery, page: { offset: number; limit: number }, ctx: FetchCtx) {
  const { features, exceeded, url } = await arcgisQuery(phlOpa, OPA_LAYER, {
    where: opaWhere(q),
    outFields: FIELDS,
    returnGeometry: true,
    outSR: 4326,
    orderByFields: 'objectid',
    resultOffset: page.offset,
    resultRecordCount: Math.min(2000, page.limit),
  }, ctx, { ttlMs: 7 * 24 * 3_600_000, timeoutMs: 25_000 });
  return { records: parseOpaFeatures(features, url), raw: features.length, exceeded, url };
}

/** Philadelphia apartment parcels whose owner mailing street matches (cross-reference by address). */
export async function fetchOpaByMailing(street: string, zip: string | null, ctx: FetchCtx) {
  const s = street.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(\d+[A-Z]?)\s+(\S+)/);
  if (!m) return { records: [] as PropertyRecord[], url: '' };
  const where = [`mailing_street LIKE ${sqlLit(`${m[1]} ${m[2]}%`)}`, `building_code_description LIKE 'APTS%'`];
  if (zip) where.push(`mailing_zip LIKE ${sqlLit(`${zip.slice(0, 5)}%`)}`);
  const { features, url } = await arcgisQuery(phlOpa, OPA_LAYER, { where: where.join(' AND '), outFields: FIELDS, returnGeometry: true, outSR: 4326, resultRecordCount: 500 }, ctx, { ttlMs: 7 * 24 * 3_600_000 });
  return { records: parseOpaFeatures(features, url), url };
}

/** Philadelphia apartment parcels owned by a named entity. */
export async function fetchOpaByOwner(name: string, ctx: FetchCtx) {
  const term = name.toUpperCase().replace(/[^A-Z0-9 &]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (term.length < 4) return { records: [] as PropertyRecord[], url: '' };
  return fetchOpaParcels({ ownerLike: [term] }, { offset: 0, limit: 500 }, ctx);
}
