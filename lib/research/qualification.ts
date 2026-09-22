import type { ResearchRunResult } from './runner';
import type { ResearchClaim, ResearchGraph } from './types';

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
  if (typeof portfolio?.value === 'number') {
    const count = portfolio.value;
    if (count >= 20 && count <= 100) {
      fit += 45;
      reasons.push('Portfolio is within the 20–100 target range.');
    } else if (count >= 10 && count <= 150) {
      fit += 25;
      reasons.push('Portfolio is near the target range.');
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

  const decisionMakers = trustedClaims(graph, root.id, 'person.decisionMaker').filter((claim) => claim.objectEntityId);
  if (decisionMakers.length) {
    actionability += 35;
    reasons.push('At least one sourced decision-maker is identified.');
  }

  const people = new Set(decisionMakers.map((claim) => claim.objectEntityId).filter((value): value is string => Boolean(value)));
  if ([...people].some((id) => trustedClaims(graph, id, 'person.email').length)) {
    actionability += 25;
    reasons.push('A decision-maker has a sourced public business email.');
  }
  if ([...people].some((id) => trustedClaims(graph, id, 'person.phone').length)) {
    actionability += 20;
    reasons.push('A decision-maker has a sourced public business phone.');
  }
  if (linkedProperties.length) actionability += 10;

  const utilityEvidence = graph.claims.some((claim) => claim.fact === 'utility.provider' && trusted(claim));
  if (utilityEvidence) {
    actionability += 10;
    reasons.push('Water utility evidence is available for at least one researched property.');
  }

  return { fit: Math.min(100, fit), actionability: Math.min(100, actionability), reasons };
}

function trustedClaims(graph: ResearchGraph, subjectId: string, fact: ResearchClaim['fact']): ResearchClaim[] {
  return graph.claims.filter((claim) => claim.subjectId === subjectId && claim.fact === fact && trusted(claim));
}

function trusted(claim: ResearchClaim): boolean {
  return (claim.state === 'VERIFIED' || claim.state === 'SUPPORTED') && claim.confidence >= 0.7;
}
