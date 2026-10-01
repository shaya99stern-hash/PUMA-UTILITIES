/** NYC MapPLUTO tax lots (Socrata 64uk-42ks): residential units, class, year built, owner of record. */
import { companyNameKey } from '@/lib/text';
import { isGenericName, streetKey, titleCase, toInt, toNumber, trimOrNull, validYear, zip5 } from '../text';
import type { PropertyRecord, SourceInfo } from '../types';
import { provenance, socrataRows, soql, type FetchCtx } from './common';

export const nycPluto: SourceInfo = {
  id: 'nyc-pluto',
  name: 'NYC PLUTO (Dept. of City Planning)',
  kind: 'discovery',
  coverage: ['NY'],
  coverageLabel: 'New York City',
  capabilities: ['buildings', 'units', 'year_built', 'owner_of_record', 'coordinates'],
  description: 'Tax-lot data for every NYC parcel: residential units, building class, year built, floors, owner of record.',
  homepage: 'https://data.cityofnewyork.us/City-Government/Primary-Land-Use-Tax-Lot-Output-PLUTO-/64uk-42ks',
  verified: 'live',
};

export const PLUTO_URL = 'https://data.cityofnewyork.us/resource/64uk-42ks.json';
const FIELDS = 'bbl,borough,address,zipcode,ownername,unitsres,unitstotal,bldgclass,yearbuilt,numfloors,latitude,longitude,bldgarea,assesstot,numbldgs';

export const NYC_BOROUGHS: Record<string, { code: string; id: number; county: string; city: string }> = {
  MN: { code: 'MN', id: 1, county: 'New York', city: 'New York' },
  BX: { code: 'BX', id: 2, county: 'Bronx', city: 'Bronx' },
  BK: { code: 'BK', id: 3, county: 'Kings', city: 'Brooklyn' },
  QN: { code: 'QN', id: 4, county: 'Queens', city: 'Queens' },
  SI: { code: 'SI', id: 5, county: 'Richmond', city: 'Staten Island' },
};

/** Maps county / borough / city names to PLUTO borough codes. */
export function nycBoroughsFor(values: string[]): string[] {
  const out = new Set<string>();
  for (const raw of values) {
    const v = raw.toLowerCase().replace(/county|borough|of/g, '').trim();
    if (['new york', 'manhattan', 'nyc', 'new york city'].includes(v)) out.add('MN');
    if (v === 'bronx' || v === 'the bronx') out.add('BX');
    if (v === 'kings' || v === 'brooklyn') out.add('BK');
    if (v === 'queens') out.add('QN');
    if (v === 'richmond' || v === 'staten island') out.add('SI');
  }
  return [...out];
}

export function isNycZip(zip: string): boolean {
  const n = Number(zip.slice(0, 3));
  return [100, 101, 102, 103, 104, 110, 111, 112, 113, 114, 116].includes(n);
}

export function normalizeBbl(value: unknown): string | null {
  const digits = String(value ?? '').split('.')[0].replace(/\D/g, '');
  return digits.length === 10 ? digits : null;
}

export function splitBbl(bbl: string): { boro: number; block: number; lot: number } {
  return { boro: Number(bbl[0]), block: Number(bbl.slice(1, 6)), lot: Number(bbl.slice(6)) };
}

export type PlutoQuery = { boroughs?: string[]; zips?: string[]; minUnits: number; maxUnits?: number; ownerLike?: string[]; bbls?: string[] };

export function plutoWhere(q: PlutoQuery): string {
  const parts = [`unitsres >= ${Math.max(1, Math.floor(q.minUnits))}`, `(bldgclass like 'C%' OR bldgclass like 'D%')`];
  if (q.maxUnits) parts.push(`unitsres <= ${Math.floor(q.maxUnits)}`);
  if (q.boroughs?.length) parts.push(`borough in (${q.boroughs.map(soql).join(',')})`);
  if (q.zips?.length) parts.push(`zipcode in (${q.zips.map(soql).join(',')})`);
  if (q.ownerLike?.length) parts.push(`(${q.ownerLike.map((k) => `upper(ownername) like ${soql(`%${k.toUpperCase()}%`)}`).join(' OR ')})`);
  if (q.bbls?.length) parts.push(`bbl in (${q.bbls.map((b) => soql(b)).join(',')})`);
  return parts.join(' AND ');
}

export function parsePlutoRows(rows: Record<string, string>[], url: string): PropertyRecord[] {
  const prov = provenance(nycPluto, url);
  const out: PropertyRecord[] = [];
  for (const r of rows) {
    const bbl = normalizeBbl(r.bbl);
    const address = trimOrNull(r.address);
    if (!bbl || !address) continue;
    const boro = NYC_BOROUGHS[String(r.borough ?? '').toUpperCase()];
    const owner = trimOrNull(r.ownername);
    const zip = zip5(r.zipcode);
    out.push({
      sourceKey: `nyc-bbl:${bbl}`,
      altKeys: [`bbl:${bbl}`, ...(zip ? [`addr:${streetKey(address)}|${zip}`] : [])],
      address: titleCase(address),
      city: boro?.city ?? 'New York',
      state: 'NY',
      zip,
      county: boro?.county ?? null,
      lat: toNumber(r.latitude),
      lon: toNumber(r.longitude),
      units: toInt(r.unitsres),
      buildings: toInt(r.numbldgs),
      yearBuilt: validYear(r.yearbuilt),
      stories: toInt(r.numfloors),
      buildingClass: trimOrNull(r.bldgclass),
      grossSqft: toInt(r.bldgarea),
      assessedValue: toNumber(r.assesstot),
      parcelId: bbl,
      bbl,
      ownerName: owner && !isGenericName(owner) ? owner.replace(/[,\s]+$/, '') : null,
      provenance: prov,
      extra: owner && !isGenericName(owner) ? { ownerKey: companyNameKey(owner) } : undefined,
    });
  }
  return out;
}

export async function fetchPlutoLots(q: PlutoQuery, page: { offset: number; limit: number }, ctx: FetchCtx) {
  const { rows, url } = await socrataRows(nycPluto, PLUTO_URL, {
    $select: FIELDS,
    $where: plutoWhere(q),
    $order: ':id',
    $limit: page.limit,
    $offset: page.offset,
  }, ctx, { ttlMs: 7 * 24 * 3_600_000 });
  return { records: parsePlutoRows(rows, url), raw: rows.length, url };
}
