/** NYC Local Law 84 energy & water benchmarking (5zyy-y8am): reported annual water use per building. */
import { toInt, toNumber, trimOrNull } from '../text';
import type { SourceInfo } from '../types';
import { chunk, socrataRows, soql, type FetchCtx } from './common';

export const nycLl84: SourceInfo = {
  id: 'nyc-ll84',
  name: 'NYC LL84 Energy & Water Benchmarking',
  kind: 'enrichment',
  coverage: ['NY'],
  coverageLabel: 'New York City (buildings > 25k sq ft)',
  capabilities: ['reported_water_use', 'energy_star_score', 'gross_floor_area'],
  description: 'Annual benchmarking filings: reported water use (kgal), ENERGY STAR score and floor area for large buildings.',
  homepage: 'https://data.cityofnewyork.us/Environment/NYC-Building-Energy-and-Water-Data-Disclosure-for-/5zyy-y8am',
  verified: 'live',
};

export const LL84_URL = 'https://data.cityofnewyork.us/resource/5zyy-y8am.json';

export type Ll84Record = {
  bbl: string;
  reportYear: number;
  propertyName: string | null;
  waterKgal: number | null;
  energyStarScore: number | null;
  grossSqft: number | null;
  url: string;
};

/** Keeps the most recent filing with a numeric water value per BBL (falls back to the latest filing). */
export function parseLl84Rows(rows: Record<string, string>[], url: string): Map<string, Ll84Record> {
  const best = new Map<string, Ll84Record>();
  for (const r of rows) {
    const bbls = String(r.nyc_borough_block_and_lot ?? '').split(/[;,\s]+/).filter((b) => /^\d{10}$/.test(b));
    const year = toInt(r.report_year) ?? 0;
    const water = toNumber(r.water_use_all_water_sources);
    const rec: Ll84Record = {
      bbl: bbls[0] ?? '',
      reportYear: year,
      propertyName: trimOrNull(r.property_name),
      waterKgal: water !== null && water > 0 ? water : null,
      energyStarScore: toInt(r.energy_star_score),
      grossSqft: toInt(r.multifamily_housing_gross ?? r.property_gfa_self_reported),
      url,
    };
    for (const bbl of bbls) {
      const prev = best.get(bbl);
      const better = !prev || (rec.waterKgal !== null && prev.waterKgal === null) || (((rec.waterKgal !== null) === (prev.waterKgal !== null)) && rec.reportYear > prev.reportYear);
      if (better) best.set(bbl, { ...rec, bbl });
    }
  }
  return best;
}

export async function fetchLl84ByBbl(bbls: string[], ctx: FetchCtx) {
  const out = new Map<string, Ll84Record>();
  for (const group of chunk([...new Set(bbls)], 80)) {
    const { rows, url } = await socrataRows(nycLl84, LL84_URL, {
      $select: 'nyc_borough_block_and_lot,property_name,report_year,water_use_all_water_sources,energy_star_score,multifamily_housing_gross,property_gfa_self_reported',
      $where: `nyc_borough_block_and_lot in (${group.map(soql).join(',')})`,
      $limit: 1000,
    }, ctx, { ttlMs: 14 * 24 * 3_600_000 });
    for (const [k, v] of parseLl84Rows(rows, url)) {
      const prev = out.get(k);
      if (!prev || (v.waterKgal !== null && (prev.waterKgal === null || v.reportYear > prev.reportYear))) out.set(k, v);
    }
  }
  return out;
}
