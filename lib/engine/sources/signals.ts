/**
 * Payment and distress signals ("do they pay their bills?"):
 *  - NYC Department of Finance tax lien sale lists (9rz4-mjek): buildings with unpaid property
 *    tax / water & sewer charges; `water_debt_only = Y` means the lien is for water debt alone.
 *  - HUD multifamily indicators (carried on HUD building records): troubled status, REAC
 *    inspection score, debt-service coverage, default/delinquency flags.
 */
import { toNumber, trimOrNull } from '../text';
import type { SourceInfo } from '../types';
import { chunk, socrataRows, soql, type FetchCtx } from './common';

export const nycLiens: SourceInfo = {
  id: 'nyc-liens',
  name: 'NYC Tax Lien Sale Lists (water & tax debt)',
  kind: 'enrichment',
  coverage: ['NY'],
  coverageLabel: 'New York City',
  capabilities: ['water_debt', 'tax_debt', 'payment_risk'],
  description: 'Properties placed on the NYC lien sale list for unpaid property tax or water/sewer charges (flags water-debt-only liens).',
  homepage: 'https://data.cityofnewyork.us/City-Government/Tax-Lien-Sale-Lists/9rz4-mjek',
  verified: 'live',
};

export const LIEN_URL = 'https://data.cityofnewyork.us/resource/9rz4-mjek.json';

export type LienRecord = { bbl: string; month: string | null; cycle: string | null; waterDebtOnly: boolean; url: string };

export function parseLienRows(rows: Record<string, string>[], url: string): Map<string, LienRecord> {
  const latest = new Map<string, LienRecord>();
  for (const r of rows) {
    const boro = Number(r.borough);
    const block = Number(r.block);
    const lot = Number(r.lot);
    if (!boro || !Number.isFinite(block) || !Number.isFinite(lot)) continue;
    const bbl = `${boro}${String(block).padStart(5, '0')}${String(lot).padStart(4, '0')}`;
    const rec: LienRecord = { bbl, month: r.month ? r.month.slice(0, 7) : null, cycle: trimOrNull(r.cycle), waterDebtOnly: /^y/i.test(r.water_debt_only ?? ''), url };
    const prev = latest.get(bbl);
    if (!prev || (rec.month ?? '') > (prev.month ?? '')) latest.set(bbl, rec);
  }
  return latest;
}

export async function fetchLiensByBbl(bbls: string[], ctx: FetchCtx): Promise<Map<string, LienRecord>> {
  const out = new Map<string, LienRecord>();
  for (const group of chunk([...new Set(bbls)], 40)) {
    const where = group
      .map((b) => `(borough=${soql(String(Number(b[0])))} AND block=${soql(String(Number(b.slice(1, 6))))} AND lot=${soql(String(Number(b.slice(6))))})`)
      .join(' OR ');
    const { rows, url } = await socrataRows(nycLiens, LIEN_URL, { $where: where, $order: 'month DESC', $limit: 1000 }, ctx, { ttlMs: 14 * 24 * 3_600_000 });
    for (const [k, v] of parseLienRows(rows, url)) {
      const prev = out.get(k);
      if (!prev || (v.month ?? '') > (prev.month ?? '')) out.set(k, v);
    }
  }
  return out;
}

export type HudHealth = { troubled: string | null; reacScore: string | null; dscr: number | null; defaultDelinquent: boolean };

export function hudHealth(extra: Record<string, unknown> | undefined): HudHealth | null {
  if (!extra) return null;
  const troubled = trimOrNull(extra.troubledCode);
  const reac = trimOrNull(extra.reacScore);
  const dscr = toNumber(extra.dscr);
  const dd = /^y/i.test(String(extra.defaultDelinquent ?? ''));
  if (!troubled && !reac && dscr === null && !dd) return null;
  return { troubled, reacScore: reac, dscr, defaultDelinquent: dd };
}

/** REAC scores look like "72c*"; under 60 fails HUD's physical inspection. */
export function reacNumber(score: string | null): number | null {
  const m = String(score ?? '').match(/^(\d{1,3})/);
  return m ? Number(m[1]) : null;
}
