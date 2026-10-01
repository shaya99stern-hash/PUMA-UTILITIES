/**
 * Pennsylvania county parcel layers beyond Philadelphia. Montgomery County publishes living-unit
 * counts, the owner of record and the owner mailing address for every parcel.
 */
import { isGenericName, mailingKey, splitCityState, streetKey, titleCase, toInt, trimOrNull, validYear, zip5 } from '../text';
import type { PropertyRecord, SourceInfo } from '../types';
import { arcgisQuery, provenance, sqlLit, type FetchCtx } from './common';

export const montcoParcels: SourceInfo = {
  id: 'pa-montco',
  name: 'Montgomery County PA Parcels',
  kind: 'discovery',
  coverage: ['PA'],
  coverageLabel: 'Montgomery County, PA',
  capabilities: ['buildings', 'units', 'owner_of_record', 'owner_mailing_address', 'care_of'],
  description: 'Montgomery County assessment parcels: living units, owner of record and owner mailing / care-of address.',
  homepage: 'https://data-montcopa.opendata.arcgis.com/',
  verified: 'live',
};

export const MONTCO_LAYER = 'https://services1.arcgis.com/kOChldNuKsox8qZD/arcgis/rest/services/Montgomery_County_Parcels/FeatureServer/6';
const FIELDS = 'TAXPIN,LOCATION1,LOC_ZIP1_Z,LIV_UNITS,OWN1,OWN2,CAREOF,ADDR1,ADDR2,ADDR3,ZIP1_ZIP2,YEAR_BUILT,LAND_USE,MUNI_CODE,TOTAL_APPR';

export function parseMontcoFeatures(features: { attributes: Record<string, unknown> }[], url: string): PropertyRecord[] {
  const prov = provenance(montcoParcels, url);
  return features.flatMap(({ attributes: a }) => {
    const pin = trimOrNull(a.TAXPIN);
    const loc = trimOrNull(a.LOCATION1);
    if (!pin || !loc) return [];
    const zip = zip5(trimOrNull(a.LOC_ZIP1_Z));
    const owner = trimOrNull(a.OWN1);
    const careOf = trimOrNull(a.CAREOF);
    const street = [trimOrNull(a.ADDR1), trimOrNull(a.ADDR2)].filter(Boolean).join(' ');
    const cs = splitCityState(trimOrNull(a.ADDR3)?.replace(/\s+\d{5}(-\d{4})?$/, '') ?? null);
    const mzip = zip5(trimOrNull(a.ZIP1_ZIP2)) ?? zip5(String(a.ADDR3 ?? '').match(/(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? null);
    return [{
      sourceKey: `pa-montco:${pin}`,
      altKeys: zip ? [`addr:${streetKey(loc)}|${zip}`] : [],
      address: titleCase(loc),
      city: null,
      state: 'PA',
      zip,
      county: 'Montgomery',
      units: toInt(a.LIV_UNITS),
      yearBuilt: validYear(a.YEAR_BUILT),
      parcelId: pin,
      ownerName: owner && !isGenericName(owner) ? owner : null,
      ownerMailingAddress: street ? `${titleCase(street)}, ${cs.city ?? ''}${cs.state ? ` ${cs.state}` : ''} ${mzip ?? ''}`.replace(/\s+/g, ' ').trim() : null,
      mailingKey: street ? mailingKey(street, cs.city, mzip) : null,
      managerName: careOf && !isGenericName(careOf) ? careOf : null,
      provenance: prov,
      extra: { mailState: cs.state, landUse: trimOrNull(a.LAND_USE), appraised: toInt(a.TOTAL_APPR) },
    }];
  });
}

export async function fetchMontcoParcels(minUnits: number, page: { offset: number; limit: number }, ctx: FetchCtx) {
  const { features, exceeded, url } = await arcgisQuery(montcoParcels, MONTCO_LAYER, {
    where: `CAST(LIV_UNITS AS INTEGER) >= ${Math.max(3, Math.floor(minUnits))}`,
    outFields: FIELDS,
    returnGeometry: false,
    orderByFields: 'OBJECTID',
    resultOffset: page.offset,
    resultRecordCount: Math.min(2000, page.limit),
  }, ctx, { ttlMs: 7 * 24 * 3_600_000 });
  return { records: parseMontcoFeatures(features, url), raw: features.length, exceeded, url };
}

/** Montgomery parcels owned by / mailed to a given owner (cross-reference). */
export async function fetchMontcoByOwner(name: string, ctx: FetchCtx) {
  const term = name.toUpperCase().replace(/[^A-Z0-9 &/]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (term.length < 4) return { records: [] as PropertyRecord[], url: '' };
  const { features, url } = await arcgisQuery(montcoParcels, MONTCO_LAYER, {
    where: `OWN1 LIKE ${sqlLit(`%${term}%`)} AND CAST(LIV_UNITS AS INTEGER) >= 3`,
    outFields: FIELDS,
    returnGeometry: false,
    resultRecordCount: 500,
  }, ctx, { ttlMs: 7 * 24 * 3_600_000 });
  return { records: parseMontcoFeatures(features, url), url };
}

export async function fetchMontcoByMailing(street: string, ctx: FetchCtx) {
  const s = street.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(\d+[A-Z]?)\s+(\S+)/);
  if (!m) return { records: [] as PropertyRecord[], url: '' };
  const { features, url } = await arcgisQuery(montcoParcels, MONTCO_LAYER, {
    where: `ADDR1 LIKE ${sqlLit(`${m[1]} ${m[2]}%`)} AND CAST(LIV_UNITS AS INTEGER) >= 3`,
    outFields: FIELDS,
    returnGeometry: false,
    resultRecordCount: 500,
  }, ctx, { ttlMs: 7 * 24 * 3_600_000 });
  return { records: parseMontcoFeatures(features, url), url };
}
