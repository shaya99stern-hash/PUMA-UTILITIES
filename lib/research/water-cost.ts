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
  sourceUnit: '1000-gallons' | 'ccf';
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
  dollarsPer1000Gallons: number;
  includesFixedCharges: false;
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

  const rateClaim = trustedClaims(graph, utility.id, 'utility.rateSchedule')
    .find((claim) => typeof claim.value === 'string' && parseVariableWaterRate(claim.value));
  if (!rateClaim || typeof rateClaim.value !== 'string') return undefined;
  const parsedRate = parseVariableWaterRate(rateClaim.value);
  if (!parsedRate) return undefined;

  const squareFeet = numericClaim(graph, propertyId, 'property.grossSquareFeet');
  const units = numericClaim(graph, propertyId, 'property.units');
  let basis: PropertyWaterCostEstimate['basis'];
  let benchmarkAnnualGallons: number;
  let low: number | undefined;
  let high: number | undefined;
  let methodology: string;

  if (squareFeet && squareFeet > 0) {
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
  const sourceUrls = [...new Set([
    ...claimUrls(graph, providerClaim),
    ...claimUrls(graph, rateClaim),
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
    dollarsPer1000Gallons: parsedRate.dollarsPer1000Gallons,
    includesFixedCharges: false,
    sourceUrls,
    methodology: methodology + ' The estimate applies only the single parseable variable water-use rate; fixed, sewer, tax, demand, and tiered charges are excluded.',
  };
}

export function parseVariableWaterRate(text: string): ParsedWaterRate | undefined {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const candidates: ParsedWaterRate[] = [];

  for (const match of normalized.matchAll(/\$\s*(\d+(?:\.\d{1,4})?)\s*(?:per|\/)\s*(?:1,?000|1000)\s*(?:gallons?|gal)\b/gi)) {
    candidates.push({ dollarsPer1000Gallons: Number(match[1]), sourceText: match[0], sourceUnit: '1000-gallons' });
  }
  for (const match of normalized.matchAll(/\$\s*(\d+(?:\.\d{1,4})?)\s*(?:per|\/)\s*(?:ccf|hcf|100\s*cubic\s*feet)\b/gi)) {
    const amount = Number(match[1]);
    candidates.push({ dollarsPer1000Gallons: amount / GALLONS_PER_CCF * 1000, sourceText: match[0], sourceUnit: 'ccf' });
  }

  const unique = candidates.filter((candidate, index, all) =>
    all.findIndex((item) => Math.abs(item.dollarsPer1000Gallons - candidate.dollarsPer1000Gallons) < 0.0001) === index
  );
  if (unique.length !== 1 || !Number.isFinite(unique[0].dollarsPer1000Gallons) || unique[0].dollarsPer1000Gallons <= 0) return undefined;
  return unique[0];
}

function numericClaim(graph: ResearchGraph, subjectId: string, fact: ResearchClaim['fact']): number | undefined {
  const claim = trustedClaims(graph, subjectId, fact).find((item) => typeof item.value === 'number' && Number.isFinite(item.value));
  return typeof claim?.value === 'number' ? claim.value : undefined;
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
