/**
 * Water + sewer spend estimates. Reported consumption (NYC LL84) is used when available,
 * otherwise the EPA multifamily benchmark (43,600 gallons per unit per year) is applied.
 * Rates are approximate combined water + sewer charges per 1,000 gallons for major utilities in
 * Puma's markets; everything here is labeled an estimate for prioritization, not a bill.
 */
import type { Dossier } from './dossier';
import { meterProgramFor, meteringAngle } from './utility-intel';

export const GALLONS_PER_UNIT_YEAR = 43_600;
const DEFAULT_RATE = 13;

type Rate = { match: RegExp; perKgal: number; label: string };

/** Approximate combined water + sewer $/1,000 gal. */
export const UTILITY_RATES: Rate[] = [
  { match: /new york city|nyc|nycdep|^ny7003493$/i, perKgal: 17.5, label: 'NYC Water Board (water + sewer)' },
  { match: /philadelphia/i, perKgal: 16, label: 'Philadelphia Water Department (water + sewer)' },
  { match: /newark/i, perKgal: 15, label: 'Newark Water (water + sewer)' },
  { match: /jersey city/i, perKgal: 15, label: 'Jersey City MUA (water + sewer)' },
  { match: /new jersey american|nj american|njaw/i, perKgal: 16, label: 'NJ American Water + municipal sewer' },
  { match: /veolia|suez|united water/i, perKgal: 15, label: 'Veolia NJ/NY + municipal sewer' },
  { match: /pennsylvania american|pa american/i, perKgal: 17, label: 'PA American Water + sewer' },
  { match: /aqua/i, perKgal: 16, label: 'Aqua + sewer' },
  { match: /pittsburgh/i, perKgal: 17, label: 'Pittsburgh Water + ALCOSAN sewer' },
  { match: /yonkers|westchester|mount vernon|new rochelle/i, perKgal: 14, label: 'Westchester municipal water + sewer' },
  { match: /buffalo|rochester|syracuse|albany/i, perKgal: 10, label: 'Upstate NY municipal water + sewer' },
  { match: /passaic valley|paterson/i, perKgal: 14, label: 'Passaic Valley Water + sewer' },
  { match: /middlesex water/i, perKgal: 14, label: 'Middlesex Water + sewer' },
  { match: /trenton/i, perKgal: 13, label: 'Trenton Water Works + sewer' },
  { match: /elizabeth/i, perKgal: 15, label: 'Elizabethtown Water (NJAW) + sewer' },
];

const STATE_DEFAULT: Record<string, number> = { NY: 15, NJ: 15, PA: 15, CT: 14, MA: 14, DE: 12, MD: 13 };

export function rateFor(utilityName: string | null, pwsid: string | null, state: string): { perKgal: number; label: string } {
  const hay = `${utilityName ?? ''} ${pwsid ?? ''}`;
  const hit = UTILITY_RATES.find((r) => r.match.test(hay));
  if (hit) return { perKgal: hit.perKgal, label: hit.label };
  const s = STATE_DEFAULT[state] ?? DEFAULT_RATE;
  return { perKgal: s, label: `${state} average combined water + sewer rate` };
}

/** Updates per-building and portfolio estimates in place. */
export function estimateWater(d: Dossier): void {
  let total = 0;
  let reported = 0;
  let anyReported = false;
  const labels = new Set<string>();
  for (const b of d.buildings) {
    const rate = rateFor(b.utilityName, b.utilityPwsid, b.state);
    labels.add(rate.label);
    const kgal = b.reportedWaterKgal ?? (b.units ? (b.units * GALLONS_PER_UNIT_YEAR) / 1000 : null);
    if (b.reportedWaterKgal) {
      anyReported = true;
      reported += b.reportedWaterKgal;
    }
    b.estAnnualWaterCost = kgal ? Math.round(kgal * rate.perKgal) : null;
    total += b.estAnnualWaterCost ?? 0;
  }
  d.water.estAnnualSpend = total > 0 ? total : null;
  d.water.estMonthlySpend = total > 0 ? Math.round(total / 12) : null;
  d.water.reportedKgal = anyReported ? Math.round(reported) : null;
  d.water.basis = total > 0
    ? `${anyReported ? 'Reported LL84 water use where filed, otherwise ' : ''}EPA benchmark of ${GALLONS_PER_UNIT_YEAR.toLocaleString()} gal per unit per year × ${[...labels].slice(0, 2).join(' / ')}`
    : null;

  const utilities = new Map<string, Dossier['water']['utilities'][number]>();
  for (const b of d.buildings) {
    if (!b.utilityPwsid || !b.utilityName) continue;
    const u = utilities.get(b.utilityPwsid);
    if (u) u.buildings += 1;
    else {
      const meter = meterProgramFor(b.utilityName, b.utilityPwsid);
      utilities.set(b.utilityPwsid, { name: b.utilityName, pwsid: b.utilityPwsid, buildings: 1, meter, angle: meteringAngle(meter) });
    }
  }
  d.water.utilities = [...utilities.values()].sort((a, b) => b.buildings - a.buildings);
}
