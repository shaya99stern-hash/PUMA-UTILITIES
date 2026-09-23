import type { OpportunityIntelligence } from '../types';
import { assessResearchRun } from './qualification';
import { rankDecisionMakers } from './decision-maker';
import { linkedCompanyPropertyIds } from './portfolio-links';
import type { ResearchRunResult } from './runner';
import type { ResearchClaim, ResearchGraph } from './types';
import { tariffTextUsableNow } from './tariff-metadata';
import { estimatePropertyWaterCost } from './water-cost';

export function buildOpportunityIntelligence(result: ResearchRunResult): OpportunityIntelligence {
  const graph = result.graph;
  const companyId = result.rootEntityId;
  const assessment = assessResearchRun(result);
  const propertyIds = linkedCompanyPropertyIds(graph, companyId);
  const decisionMakers = rankDecisionMakers(graph, companyId);
  const top = decisionMakers[0];

  const officialOwnershipProperties = propertyIds.filter((propertyId) =>
    trustedClaims(graph, propertyId, 'property.owner').some((claim) =>
      claim.evidenceIds.some((id) => graph.evidence.find((evidence) => evidence.id === id)?.authority === 'official')
    )
  ).length;

  const providersByProperty = new Map<string,string[]>();
  for (const propertyId of propertyIds) {
    providersByProperty.set(propertyId, [...new Set(
      trustedClaims(graph, propertyId, 'utility.provider')
        .map((claim) => claim.objectEntityId)
        .filter((value): value is string => Boolean(value))
    )]);
  }
  const utilityResolvedProperties = [...providersByProperty.values()].filter((ids) => ids.length === 1).length;
  const rateResolvedProperties = [...providersByProperty.entries()].filter(([, ids]) =>
    ids.length === 1 && trustedClaims(graph, ids[0], 'utility.rateSchedule').some((claim) => typeof claim.value === 'string' && tariffTextUsableNow(claim.value))
  ).length;

  const estimates = propertyIds
    .map((propertyId) => estimatePropertyWaterCost(graph, propertyId))
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  const annualWaterSpendBenchmark = estimates.length
    ? Math.round(estimates.reduce((sum, estimate) => sum + estimate.annualEstimatedWaterCost, 0))
    : undefined;

  const denominator = Math.max(1, propertyIds.length);
  const ownershipPercent = percent(officialOwnershipProperties, denominator);
  const utilityPercent = percent(utilityResolvedProperties, denominator);
  const ratePercent = percent(rateResolvedProperties, denominator);
  const benchmarkPercent = percent(estimates.length, denominator);
  const contactPercent = top?.email || top?.phone ? 100 : top?.contactStatus === 'company-only' ? 50 : 0;
  const coverageScore = Math.round((ownershipPercent + utilityPercent + ratePercent + benchmarkPercent + contactPercent) / 5);
  const priority = Math.max(0, Math.min(100, Math.round(assessment.fit * 0.45 + assessment.actionability * 0.35 + coverageScore * 0.2)));

  const exactPortfolio = trustedClaims(graph, companyId, 'company.portfolio').some((claim) => typeof claim.value === 'number');
  const gaps: string[] = [];
  if (!exactPortfolio) gaps.push('Exact portfolio size is not yet verified.');
  if (!propertyIds.length) gaps.push('No first-party or equivalent-entity property relationship is verified yet.');
  if (propertyIds.length && officialOwnershipProperties < propertyIds.length) gaps.push('Some linked properties still lack official ownership corroboration.');
  if (propertyIds.length && utilityResolvedProperties < propertyIds.length) gaps.push('Some linked properties still lack one resolved water provider.');
  if (utilityResolvedProperties && rateResolvedProperties < utilityResolvedProperties) gaps.push('Current published water-rate evidence is incomplete for resolved utilities.');
  if (!top || (!top.email && !top.phone)) gaps.push('No direct published business contact is attached to the top decision-maker.');
  if (!estimates.length) gaps.push('No property has enough sourced residential and active tariff inputs for a water-cost benchmark.');

  const nextActions: string[] = [];
  if (!exactPortfolio) nextActions.push('Resolve exact portfolio size from a first-party or official source.');
  if (!top || (!top.email && !top.phone)) nextActions.push('Resolve a published business email or phone for the top-ranked operating decision-maker.');
  if (propertyIds.length && ownershipPercent < 70) nextActions.push('Corroborate ownership on the highest-value unresolved portfolio properties.');
  if (propertyIds.length && utilityPercent < 70) nextActions.push('Resolve water providers for additional linked properties.');
  if (utilityResolvedProperties && ratePercent < 70) nextActions.push('Resolve a current published water tariff for utilities already tied to the portfolio.');
  if (annualWaterSpendBenchmark) nextActions.push(`Use the ~$${annualWaterSpendBenchmark.toLocaleString()}/yr researched water benchmark across ${estimates.length} propert${estimates.length === 1 ? 'y' : 'ies'} to prioritize outreach; validate actual bills after client authorization.`);
  if (!nextActions.length) nextActions.push('Validate account-level bills and meter access with the prospect before quantifying savings.');

  const confidence: OpportunityIntelligence['confidence'] =
    result.rootCompleteness >= 0.8 && contactPercent === 100 && (propertyIds.length === 0 || ownershipPercent >= 60)
      ? 'high'
      : result.rootCompleteness >= 0.55 && (contactPercent >= 50 || utilityResolvedProperties > 0)
        ? 'medium'
        : 'developing';

  const rationale = [...assessment.reasons];
  if (propertyIds.length) rationale.push(`${propertyIds.length} property relationship(s) survive conservative company/entity reconciliation.`);
  if (annualWaterSpendBenchmark) rationale.push(`${estimates.length} property benchmark(s) total approximately $${annualWaterSpendBenchmark.toLocaleString()} per year in modeled water cost.`);

  return {
    priority,
    confidence,
    annualWaterSpendBenchmark,
    linkedProperties:propertyIds.length,
    officialOwnershipProperties,
    utilityResolvedProperties,
    rateResolvedProperties,
    benchmarkedProperties:estimates.length,
    directContactCount:decisionMakers.filter((person) => person.email || person.phone).length,
    coverage:{ ownershipPercent, utilityPercent, ratePercent, benchmarkPercent, contactPercent },
    topContact:top ? { name:top.name, title:top.title, score:top.score, contactStatus:top.contactStatus } : undefined,
    nextActions:nextActions.slice(0,6),
    gaps:gaps.slice(0,8),
    rationale:rationale.slice(0,12),
  };
}

function percent(value: number, denominator: number): number { return Math.max(0, Math.min(100, Math.round(value / Math.max(1, denominator) * 100))); }
function trustedClaims(graph: ResearchGraph, subjectId: string, fact: ResearchClaim['fact']): ResearchClaim[] { return graph.claims.filter((claim) => claim.subjectId === subjectId && claim.fact === fact && trusted(claim)); }
function trusted(claim: ResearchClaim): boolean { return (claim.state === 'VERIFIED' || claim.state === 'SUPPORTED') && claim.confidence >= 0.7; }
