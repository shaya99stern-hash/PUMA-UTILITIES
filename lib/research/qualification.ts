import type { ResearchRunResult } from './runner';
import type { ResearchClaim, ResearchGraph } from './types';
import { rankDecisionMakers } from './decision-maker';
import { estimatePropertyWaterCost } from './water-cost';

export type ProspectAssessment = {
  fit: number;
  actionability: number;
  reasons: string[];
};

export function assessResearchRun(result: ResearchRunResult): ProspectAssessment {
  const graph = result.graph;
  const root = graph.entities.find((entity) => entity.id === result.rootEntityId);
  if (!root || root.kind !== 'company') return { fit: 0, actionability: 0, reasons: ['Root research entity is not a company.'] };

  const reasons: string[] = [];
  let fit = 0;
  let actionability = 0;

  const portfolio = trustedClaims(graph, root.id, 'company.portfolio').find((claim) => typeof claim.value === 'number');
  const lowerBound = trustedClaims(graph, root.id, 'company.portfolioLowerBound')
    .filter((claim) => typeof claim.value === 'number')
    .sort((left, right) => Number(right.value) - Number(left.value))[0];
  if (typeof portfolio?.value === 'number') {
    const count = portfolio.value;
    if (count >= 20 && count <= 100) {
      fit += 45;
      reasons.push('Portfolio is within the 20–100 target range.');
    } else if (count >= 10 && count <= 150) {
      fit += 25;
      reasons.push('Portfolio is near the target range.');
    }
  } else if (typeof lowerBound?.value === 'number') {
    const count = lowerBound.value;
    if (count >= 20 && count <= 100) {
      fit += 35;
      reasons.push(`Portfolio evidence establishes at least ${count} buildings/properties; the upper bound remains unresolved.`);
    } else if (count >= 10 && count < 20) {
      fit += 18;
      reasons.push(`Portfolio evidence establishes at least ${count} buildings/properties; more size evidence is needed.`);
    } else if (count > 100) {
      fit += 12;
      reasons.push(`Portfolio evidence establishes at least ${count} buildings/properties, above Puma's 20–100 target band.`);
    }
  }

  const ownerOperator = trustedClaims(graph, root.id, 'company.ownerOperator').find((claim) => String(claim.value ?? '').trim());
  if (ownerOperator && /owner|operator|self|manage/i.test(String(ownerOperator.value))) {
    fit += 30;
    reasons.push('Evidence supports owner/operator or self-management alignment.');
  }

  if (['NJ', 'NY', 'PA'].includes((root.geography ?? '').toUpperCase())) {
    fit += 15;
    reasons.push('Company is in Puma\'s core NJ/NY/PA geography.');
  }

  const linkedProperties = graph.claims.filter((claim) =>
    claim.objectEntityId === root.id &&
    (claim.fact === 'property.manager' || claim.fact === 'property.owner') &&
    trusted(claim)
  );
  if (linkedProperties.length) {
    fit += Math.min(10, linkedProperties.length);
    reasons.push(`${linkedProperties.length} property relationship(s) are sourced.`);
  }

  const rankedPeople = rankDecisionMakers(graph, root.id);
  if (rankedPeople.length) {
    actionability += 35;
    reasons.push(`${rankedPeople.length} sourced decision-maker candidate(s) are ranked by operational relevance and contact evidence.`);
    const top = rankedPeople[0];
    if (top.score >= 75) {
      actionability += 15;
      reasons.push(`Top contact path is strong: ${top.name}${top.title ? ` — ${top.title}` : ''}.`);
    }
    if (top.email) {
      actionability += 25;
      reasons.push('Top-ranked decision-maker has a sourced public business email.');
    } else if (top.phone) {
      actionability += 18;
      reasons.push('Top-ranked decision-maker has a sourced public business phone.');
    }
  }
  if (linkedProperties.length) actionability += 10;

  const utilityEvidence = graph.claims.some((claim) => claim.fact === 'utility.provider' && trusted(claim));
  if (utilityEvidence) {
    actionability += 7;
    reasons.push('Water utility evidence is available for at least one researched property.');
  }

  const estimatedProperties = [...new Set(linkedProperties.map((claim) => claim.subjectId))]
    .filter((propertyId) => Boolean(estimatePropertyWaterCost(graph, propertyId)));
  if (estimatedProperties.length) {
    actionability += 8;
    reasons.push(`${estimatedProperties.length} property water-cost benchmark estimate(s) have sourced residential inputs and a parseable published variable rate.`);
  }

  return { fit: Math.min(100, fit), actionability: Math.min(100, actionability), reasons };
}

function trustedClaims(graph: ResearchGraph, subjectId: string, fact: ResearchClaim['fact']): ResearchClaim[] {
  return graph.claims.filter((claim) => claim.subjectId === subjectId && claim.fact === fact && trusted(claim));
}

function trusted(claim: ResearchClaim): boolean {
  return (claim.state === 'VERIFIED' || claim.state === 'SUPPORTED') && claim.confidence >= 0.7;
}
