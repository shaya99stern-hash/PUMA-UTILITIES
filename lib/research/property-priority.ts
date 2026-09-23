import { linkedCompanyPropertyIds } from './portfolio-links';
import type { ResearchClaim, ResearchGraph } from './types';
import { estimatePropertyWaterCost } from './water-cost';
import type { Workspace } from '../types';

export type PropertyOpportunitySummary = {
  propertyId?: string;
  propertyName: string;
  state?: string;
  score: number;
  annualWaterSpendBenchmark?: number;
  provider?: string;
  units?: number;
  grossSquareFeet?: number;
  officialOwner: boolean;
  rateResolved: boolean;
  gaps: string[];
};

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

    return [{
      propertyId,
      propertyName:property.label,
      state:property.geography,
      score:propertyScore(estimate?.annualEstimatedWaterCost, officialOwner, Boolean(provider), rateResolved, Boolean(units), Boolean(grossSquareFeet), units),
      annualWaterSpendBenchmark:estimate?.annualEstimatedWaterCost,
      provider:provider?.label,
      units,
      grossSquareFeet,
      officialOwner,
      rateResolved,
      gaps,
    }];
  }).sort(compareOpportunity);
}

export function rankWorkspacePropertyOpportunities(workspace: Workspace, companyId: string): PropertyOpportunitySummary[] {
  return workspace.properties.filter((property) => property.companyId === companyId).map((property): PropertyOpportunitySummary => {
    const utilities = workspace.utilities.filter((utility) => utility.propertyId === property.id);
    const utility = utilities.length === 1 ? utilities[0] : undefined;
    const estimate = utility?.benchmarkCost;
    const officialOwner = property.parcelIds.length > 0;
    const rateResolved = utility?.rateSummary?.status !== 'unknown' && Boolean(utility?.rateSummary?.value);
    const units = property.units?.status !== 'unknown' ? property.units?.value : undefined;
    const grossSquareFeet = property.grossSquareFeet?.status !== 'unknown' ? property.grossSquareFeet?.value : undefined;
    const gaps: string[] = [];
    if (!officialOwner) gaps.push('Official parcel/ownership corroboration unresolved.');
    if (!utility) gaps.push('Water provider unresolved.');
    else if (!rateResolved) gaps.push('Current published water rate unresolved.');
    if (!units) gaps.push('Residential unit evidence unresolved.');
    return {
      propertyId:property.id,
      propertyName:property.name,
      state:property.state,
      score:propertyScore(estimate?.annualEstimatedWaterCost, officialOwner, Boolean(utility), rateResolved, Boolean(units), Boolean(grossSquareFeet), units),
      annualWaterSpendBenchmark:estimate?.annualEstimatedWaterCost,
      provider:utility?.provider,
      units,
      grossSquareFeet,
      officialOwner,
      rateResolved,
      gaps,
    };
  }).sort(compareOpportunity);
}

function propertyScore(annual: number | undefined, owner: boolean, provider: boolean, rate: boolean, unitsKnown: boolean, areaKnown: boolean, units?: number): number {
  let score = 0;
  if (annual) score += annual >= 100_000 ? 38 : annual >= 50_000 ? 31 : annual >= 20_000 ? 24 : 16;
  else if (units) score += Math.min(18, 6 + Math.round(Math.log10(Math.max(10, units)) * 4));
  if (owner) score += 18;
  if (provider) score += 14;
  if (rate) score += 14;
  if (unitsKnown) score += 10;
  if (areaKnown) score += 6;
  return Math.min(100, score);
}
function compareOpportunity(left: PropertyOpportunitySummary, right: PropertyOpportunitySummary): number {
  return right.score - left.score || (right.annualWaterSpendBenchmark ?? 0) - (left.annualWaterSpendBenchmark ?? 0) || left.propertyName.localeCompare(right.propertyName);
}
function trustedClaims(graph: ResearchGraph, subjectId: string, fact: ResearchClaim['fact']): ResearchClaim[] {
  return graph.claims.filter((claim) => claim.subjectId === subjectId && claim.fact === fact && trusted(claim));
}
function numericClaim(graph: ResearchGraph, subjectId: string, fact: ResearchClaim['fact']): number | undefined {
  const value = trustedClaims(graph, subjectId, fact).find((claim) => typeof claim.value === 'number' && Number.isFinite(claim.value))?.value;
  return typeof value === 'number' ? value : undefined;
}
function trusted(claim: ResearchClaim): boolean { return (claim.state === 'VERIFIED' || claim.state === 'SUPPORTED') && claim.confidence >= 0.7; }
