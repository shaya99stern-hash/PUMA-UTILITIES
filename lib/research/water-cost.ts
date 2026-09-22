import type { ResearchClaim, ResearchGraph } from './types';

export const EPA_MULTIFAMILY_GALLONS_PER_UNIT_YEAR = 43_600;
export const EPA_MULTIFAMILY_WUI = {
  p25: 31.71,
  median: 45.15,
  p75: 65.56,
} as const;
export const GALLONS_PER_CCF = 748;

export type ParsedWaterRate = {
  dollarsPer1000Gallons: number;
  sourceText: string;
  sourceUnit: '1000-gallons' | '10000-gallons' | 'ccf' | '1000-cubic-feet';
};

export type ParsedFixedWaterCharge = {
  monthlyDollars: number;
  sourceText: string;
};

export type PropertyWaterCostEstimate = {
  propertyId: string;
  utilityId: string;
  provider: string;
  basis: 'epa-multifamily-gallons-per-unit' | 'epa-multifamily-wui';
  benchmarkAnnualGallons: number;
  benchmarkAnnualGallonsLow?: number;
  benchmarkAnnualGallonsHigh?: number;
  annualVariableCost: number;
  annualVariableCostLow?: number;
  annualVariableCostHigh?: number;
  monthlyVariableCost: number;
  annualFixedWaterCharge?: number;
  monthlyFixedWaterCharge?: number;
  annualEstimatedWaterCost: number;
  monthlyEstimatedWaterCost: number;
  dollarsPer1000Gallons: number;
  includesFixedCharges: boolean;
  sourceUrls: string[];
  methodology: string;
};

export function estimatePropertyWaterCost(graph: ResearchGraph, propertyId: string): PropertyWaterCostEstimate | undefined {
  const property = graph.entities.find((entity) => entity.id === propertyId && entity.kind === 'property');
  if (!property) return undefined;

  const providerClaim = trustedClaims(graph, propertyId, 'utility.provider').find((claim) => claim.objectEntityId);
  if (!providerClaim?.objectEntityId) return undefined;
  const utility = graph.entities.find((entity) => entity.id === providerClaim.objectEntityId && entity.kind === 'utility');
  if (!utility) return undefined;

  const parsedRateClaims = trustedClaims(graph, utility.id, 'utility.rateSchedule')
    .flatMap((claim) => {
      if (typeof claim.value !== 'string') return [];
      const parsed = parseVariableWaterRate(claim.value);
      return parsed ? [{ claim, parsed }] : [];
    });
  const distinctRates = parsedRateClaims.filter((item, index, all) =>
    all.findIndex((other) => Math.abs(other.parsed.dollarsPer1000Gallons - item.parsed.dollarsPer1000Gallons) < 0.0001) === index
  );
  if (distinctRates.length !== 1) return undefined;
  const parsedRate = distinctRates[0].parsed;
  const rateClaim = parsedRateClaims
    .filter((item) => Math.abs(item.parsed.dollarsPer1000Gallons - parsedRate.dollarsPer1000Gallons) < 0.0001)
    .sort((left, right) => right.claim.confidence - left.claim.confidence)[0]?.claim;
  if (!rateClaim) return undefined;

  const fixedChargeClaims = trustedClaims(graph, utility.id, 'utility.rateSchedule')
    .flatMap((claim) => {
      if (typeof claim.value !== 'string') return [];
      const parsed = parseFixedWaterCharge(claim.value);
      return parsed ? [{ claim, parsed }] : [];
    });
  const distinctFixedCharges = fixedChargeClaims.filter((item, index, all) =>
    all.findIndex((other) => Math.abs(other.parsed.monthlyDollars - item.parsed.monthlyDollars) < 0.0001) === index
  );
  const fixedCharge = distinctFixedCharges.length === 1 ? distinctFixedCharges[0] : undefined;

  const squareFeetClaim = numericTrustedClaim(graph, propertyId, 'property.grossSquareFeet');
  const unitsClaim = numericTrustedClaim(graph, propertyId, 'property.units');
  const squareFeet = typeof squareFeetClaim?.value === 'number' ? squareFeetClaim.value : undefined;
  const units = typeof unitsClaim?.value === 'number' ? unitsClaim.value : undefined;
  let basis: PropertyWaterCostEstimate['basis'];
  let benchmarkAnnualGallons: number;
  let low: number | undefined;
  let high: number | undefined;
  let methodology: string;

  if (squareFeet && squareFeet > 0 && units && units > 0) {
    basis = 'epa-multifamily-wui';
    benchmarkAnnualGallons = squareFeet * EPA_MULTIFAMILY_WUI.median;
    low = squareFeet * EPA_MULTIFAMILY_WUI.p25;
    high = squareFeet * EPA_MULTIFAMILY_WUI.p75;
    methodology = 'ENERGY STAR / EPA WaterSense multifamily WUI 25th, median, and 75th percentiles multiplied by sourced gross floor area.';
  } else if (units && units > 0) {
    basis = 'epa-multifamily-gallons-per-unit';
    benchmarkAnnualGallons = units * EPA_MULTIFAMILY_GALLONS_PER_UNIT_YEAR;
    methodology = 'EPA WaterSense multifamily median of 43,600 gallons per unit per year multiplied by sourced unit count.';
  } else {
    return undefined;
  }

  const annualVariableCost = benchmarkAnnualGallons / 1000 * parsedRate.dollarsPer1000Gallons;
  const monthlyFixedWaterCharge = fixedCharge?.parsed.monthlyDollars;
  const annualFixedWaterCharge = monthlyFixedWaterCharge === undefined ? undefined : monthlyFixedWaterCharge * 12;
  const annualEstimatedWaterCost = annualVariableCost + (annualFixedWaterCharge ?? 0);
  const sourceUrls = [...new Set([
    ...claimUrls(graph, providerClaim),
    ...claimUrls(graph, rateClaim),
    ...(fixedCharge ? claimUrls(graph, fixedCharge.claim) : []),
    ...(unitsClaim ? claimUrls(graph, unitsClaim) : []),
    ...(squareFeetClaim ? claimUrls(graph, squareFeetClaim) : []),
    'https://www.energystar.gov/buildings/benchmark/understand-metrics/what-water-use-intensity-wui',
    'https://www.epa.gov/watersense/understanding-your-water-bill',
  ])];

  return {
    propertyId,
    utilityId: utility.id,
    provider: utility.label,
    basis,
    benchmarkAnnualGallons: round(benchmarkAnnualGallons),
    benchmarkAnnualGallonsLow: low === undefined ? undefined : round(low),
    benchmarkAnnualGallonsHigh: high === undefined ? undefined : round(high),
    annualVariableCost: money(annualVariableCost),
    annualVariableCostLow: low === undefined ? undefined : money(low / 1000 * parsedRate.dollarsPer1000Gallons),
    annualVariableCostHigh: high === undefined ? undefined : money(high / 1000 * parsedRate.dollarsPer1000Gallons),
    monthlyVariableCost: money(annualVariableCost / 12),
    annualFixedWaterCharge: annualFixedWaterCharge === undefined ? undefined : money(annualFixedWaterCharge),
    monthlyFixedWaterCharge: monthlyFixedWaterCharge === undefined ? undefined : money(monthlyFixedWaterCharge),
    annualEstimatedWaterCost: money(annualEstimatedWaterCost),
    monthlyEstimatedWaterCost: money(annualEstimatedWaterCost / 12),
    dollarsPer1000Gallons: parsedRate.dollarsPer1000Gallons,
    includesFixedCharges: Boolean(fixedCharge),
    sourceUrls,
    methodology: methodology + (fixedCharge
      ? ' A single unambiguous published monthly water service charge is included. Sewer, wastewater, tax, demand, meter-size-dependent and unresolved tiered charges are excluded.'
      : ' Fixed, sewer, wastewater, tax, demand, meter-size-dependent and unresolved tiered charges are excluded.'),
  };
}

export function parseFixedWaterCharge(text: string): ParsedFixedWaterCharge | undefined {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (/\b(sewer|wastewater)\b/i.test(normalized)) return undefined;
  if (/\b\d+(?:\/\d+)?\s*(?:inch|in\.?|")\s*meter\b/i.test(normalized)) return undefined;

  const candidates: ParsedFixedWaterCharge[] = [];
  const add = (amountText: string, divisor: number, sourceText: string) => {
    const amount = Number(amountText);
    const monthlyDollars = amount / divisor;
    if (Number.isFinite(monthlyDollars) && monthlyDollars > 0 && monthlyDollars < 100_000) {
      candidates.push({ monthlyDollars, sourceText });
    }
  };

  const patterns: Array<{ pattern: RegExp; divisor: number }> = [
    { pattern:/monthly\s+(?:water\s+)?(?:service|base|customer|minimum)\s+charge\s*[:\-]?\s*\$\s*(\d+(?:\.\d{1,2})?)/gi, divisor:1 },
    { pattern:/(?:water\s+)?(?:service|base|customer|minimum)\s+charge(?:\s+of)?\s*\$\s*(\d+(?:\.\d{1,2})?)\s*(?:per|\/)\s*month\b/gi, divisor:1 },
    { pattern:/\$\s*(\d+(?:\.\d{1,2})?)\s*(?:per|\/)\s*month\s+(?:water\s+)?(?:service|base|customer|minimum)\s+charge\b/gi, divisor:1 },
    { pattern:/quarterly\s+(?:water\s+)?(?:service|base|customer|minimum)\s+charge\s*[:\-]?\s*\$\s*(\d+(?:\.\d{1,2})?)/gi, divisor:3 },
    { pattern:/(?:water\s+)?(?:service|base|customer|minimum)\s+charge(?:\s+of)?\s*\$\s*(\d+(?:\.\d{1,2})?)\s*(?:per|\/)\s*quarter\b/gi, divisor:3 },
    { pattern:/(?:water\s+)?(?:service|base|customer|minimum)\s+charge(?:\s+of)?\s*\$\s*(\d+(?:\.\d{1,2})?).{0,24}(?:every|per)\s+two\s+months\b/gi, divisor:2 },
    { pattern:/(?:annual|yearly)\s+(?:water\s+)?(?:service|base|customer|minimum)\s+charge\s*[:\-]?\s*\$\s*(\d+(?:\.\d{1,2})?)/gi, divisor:12 },
    { pattern:/(?:water\s+)?(?:service|base|customer|minimum)\s+charge(?:\s+of)?\s*\$\s*(\d+(?:\.\d{1,2})?)\s*(?:per|\/)\s*year\b/gi, divisor:12 },
  ];
  for (const { pattern, divisor } of patterns) {
    for (const match of normalized.matchAll(pattern)) add(match[1], divisor, match[0]);
  }

  const unique = candidates.filter((candidate, index, all) =>
    all.findIndex((item) => Math.abs(item.monthlyDollars - candidate.monthlyDollars) < 0.0001) === index
  );
  return unique.length === 1 ? unique[0] : undefined;
}

export function parseVariableWaterRate(text: string): ParsedWaterRate | undefined {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (/\b(sewer|wastewater)\b/i.test(normalized)) return undefined;
  if (/\b(irrigation-only|fire protection|hydrant service)\b/i.test(normalized)) return undefined;
  const candidates: ParsedWaterRate[] = [];

  for (const match of normalized.matchAll(/\$\s*(\d+(?:\.\d{1,4})?)\s*(?:per|\/)\s*(?:10,?000|10000)\s*(?:gallons?|gal)\b/gi)) {
    candidates.push({ dollarsPer1000Gallons: Number(match[1]) / 10, sourceText: match[0], sourceUnit: '10000-gallons' });
  }
  for (const match of normalized.matchAll(/\$\s*(\d+(?:\.\d{1,4})?)\s*(?:per|\/)\s*(?:1,?000|1000)\s*(?:gallons?|gal)\b/gi)) {
    candidates.push({ dollarsPer1000Gallons: Number(match[1]), sourceText: match[0], sourceUnit: '1000-gallons' });
  }
  for (const match of normalized.matchAll(/\$\s*(\d+(?:\.\d{1,4})?)\s*(?:per|\/)\s*(?:ccf|hcf|100\s*cubic\s*feet)\b/gi)) {
    const amount = Number(match[1]);
    candidates.push({ dollarsPer1000Gallons: amount / GALLONS_PER_CCF * 1000, sourceText: match[0], sourceUnit: 'ccf' });
  }
  for (const match of normalized.matchAll(/\$\s*(\d+(?:\.\d{1,4})?)\s*(?:per|\/)\s*(?:1,?000|1000)\s*cubic\s*feet\b/gi)) {
    const amount = Number(match[1]);
    candidates.push({ dollarsPer1000Gallons: amount / (GALLONS_PER_CCF * 10) * 1000, sourceText: match[0], sourceUnit: '1000-cubic-feet' });
  }

  const unique = candidates.filter((candidate, index, all) =>
    all.findIndex((item) => Math.abs(item.dollarsPer1000Gallons - candidate.dollarsPer1000Gallons) < 0.0001) === index
  );
  if (unique.length !== 1 || !Number.isFinite(unique[0].dollarsPer1000Gallons) || unique[0].dollarsPer1000Gallons <= 0) return undefined;
  return unique[0];
}

function numericTrustedClaim(graph: ResearchGraph, subjectId: string, fact: ResearchClaim['fact']): ResearchClaim | undefined {
  return trustedClaims(graph, subjectId, fact).find((item) => typeof item.value === 'number' && Number.isFinite(item.value));
}

function trustedClaims(graph: ResearchGraph, subjectId: string, fact: ResearchClaim['fact']): ResearchClaim[] {
  return graph.claims.filter((claim) =>
    claim.subjectId === subjectId &&
    claim.fact === fact &&
    (claim.state === 'VERIFIED' || claim.state === 'SUPPORTED') &&
    claim.confidence >= 0.7
  );
}

function claimUrls(graph: ResearchGraph, claim: ResearchClaim): string[] {
  return claim.evidenceIds.flatMap((id) => {
    const evidence = graph.evidence.find((item) => item.id === id);
    return evidence?.url ? [evidence.url] : [];
  });
}

function round(value: number): number {
  return Math.round(value);
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}
