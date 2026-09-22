import type { PropertyOpportunitySummary } from '../types';
import { linkedCompanyPropertyIds } from './portfolio-links';
import type { ResearchClaim, ResearchGraph } from './types';
import { estimatePropertyWaterCost } from './water-cost';

export function rankPropertyOpportunities(graph: ResearchGraph, companyId: string): PropertyOpportunitySummary[] {
  return linkedCompanyPropertyIds(graph, companyId).flatMap((propertyId): PropertyOpportunitySummary[] => {
    const property = graph.entities.find((entity) => entity.id === propertyId && entity.kind === 'property');
    if (!property) return [];
    const ownerClaims = trustedClaims(graph, propertyId, 'property.owner');
    const officialOwner = ownerClaims.some((claim) => claim.evidenceIds.some((id) => graph.evidence.find((evidence) => evidence.id === id)?.authority === 'official'));
    const providers = [...new Set(trustedClaims(graph, propertyId, 'utility.provider').map((claim) => claim.objectEntityId).filter((value): value is string => Boolean(value)))];
    const provider = providers.length === 1 ? graph.entities.find((entity) => entity.id === providers[0]) : undefined;
    const rateResolved = Boolean(provider && trustedClaims(graph, provider.id, 'utility.rateSchedule').length);
    const units = numericClaim(graph, propertyId, 'property.units');
    const grossSquareFeet = numericClaim(graph, propertyId, 'property.grossSquareFeet');
    const estimate = estimatePropertyWaterCost(graph, propertyId);
    const gaps: string[] = [];
    if (!officialOwner) gaps.push('Official ownership corroboration unresolved.');
    if (!provider) gaps.push('Water provider unresolved.');
    else if (!rateResolved) gaps.push('Current published water rate unresolved.');
    if (!units) gaps.push('Residential unit evidence unresolved.');

    let score = 0;
    if (estimate) {
      const annual = estimate.annualEstimatedWaterCost;
      score += annual >= 100_000 ? 38 : annual >= 50_000 ? 31 : annual >= 20_000 ? 24 : annual > 0 ? 16 : 0;
    } else if (units) score += Math.min(18, 6 + Math.round(Math.log10(Math.max(10, units)) * 4));
    if (officialOwner) score += 18;
    if (provider) score += 14;
    if (rateResolved) score += 14;
    if (units) score += 10;
    if (grossSquareFeet) score += 6;

    return [{
      propertyName:property.label,
      state:property.geography,
      score:Math.min(100, score),
      annualWaterSpendBenchmark:estimate?.annualEstimatedWaterCost,
      provider:provider?.label,
      units,
      grossSquareFeet,
      officialOwner,
      rateResolved,
      gaps,
    }];
  }).sort((left, right) => right.score - left.score || (right.annualWaterSpendBenchmark ?? 0) - (left.annualWaterSpendBenchmark ?? 0) || left.propertyName.localeCompare(right.propertyName));
}

function trustedClaims(graph: ResearchGraph, subjectId: string, fact: ResearchClaim['fact']): ResearchClaim[] {
  return graph.claims.filter((claim) => claim.subjectId === subjectId && claim.fact === fact && trusted(claim));
}
function numericClaim(graph: ResearchGraph, subjectId: string, fact: ResearchClaim['fact']): number | undefined {
  const value = trustedClaims(graph, subjectId, fact).find((claim) => typeof claim.value === 'number' && Number.isFinite(claim.value))?.value;
  return typeof value === 'number' ? value : undefined;
}
function trusted(claim: ResearchClaim): boolean { return (claim.state === 'VERIFIED' || claim.state === 'SUPPORTED') && claim.confidence >= 0.7; }
