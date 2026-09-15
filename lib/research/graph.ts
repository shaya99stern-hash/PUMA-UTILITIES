import type { ResearchClaim, ResearchEntity, ResearchEvidence, ResearchFact, ResearchGraph, ResearchNeed } from './types';

const COMPANY_FACT_IMPORTANCE: Record<ResearchFact, number> = {
  'company.identity': 100,
  'company.website': 90,
  'company.phone': 80,
  'company.email': 82,
  'company.ownerOperator': 98,
  'company.portfolio': 96,
  'person.decisionMaker': 100,
  'person.title': 90,
  'person.phone': 84,
  'person.email': 88,
  'property.identity': 94,
  'property.owner': 96,
  'property.manager': 95,
  'utility.provider': 92,
  'utility.amiCapability': 80,
  'utility.buildingMeterStatus': 70,
};

const COMPANY_REQUIRED_FACTS: ResearchFact[] = [
  'company.identity',
  'company.website',
  'company.phone',
  'company.email',
  'company.ownerOperator',
  'company.portfolio',
  'person.decisionMaker',
  'person.title',
  'person.phone',
  'person.email',
  'utility.provider',
  'utility.amiCapability',
];

export function createResearchGraph(): ResearchGraph {
  return { entities: [], evidence: [], claims: [] };
}

export function normalizeLabel(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\b(the|incorporated|inc|llc|l\.l\.c|corp|corporation|company|co|lp|l\.p)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function upsertEntity(graph: ResearchGraph, entity: Omit<ResearchEntity, 'normalizedLabel'> & { normalizedLabel?: string }): ResearchEntity {
  const normalizedLabel = entity.normalizedLabel ?? normalizeLabel(entity.label);
  const existing = graph.entities.find((item) => item.id === entity.id);
  if (existing) {
    Object.assign(existing, entity, { normalizedLabel });
    return existing;
  }
  const created: ResearchEntity = { ...entity, normalizedLabel };
  graph.entities.push(created);
  return created;
}

export function addEvidence(graph: ResearchGraph, evidence: ResearchEvidence): ResearchEvidence {
  const existing = graph.evidence.find((item) => item.id === evidence.id);
  if (existing) return existing;
  graph.evidence.push(evidence);
  return evidence;
}

export function addClaim(graph: ResearchGraph, claim: ResearchClaim): ResearchClaim {
  const existing = graph.claims.find((item) => item.id === claim.id);
  if (existing) return existing;

  const competing = graph.claims.filter((item) =>
    item.subjectId === claim.subjectId &&
    item.fact === claim.fact &&
    item.state !== 'UNRESOLVED' &&
    claim.state !== 'UNRESOLVED' &&
    !sameClaimValue(item, claim)
  );

  if (competing.length) {
    for (const item of competing) item.state = 'CONFLICTED';
    claim.state = 'CONFLICTED';
  }

  graph.claims.push(claim);
  return claim;
}

export function bestClaim(graph: ResearchGraph, subjectId: string, fact: ResearchFact): ResearchClaim | undefined {
  return graph.claims
    .filter((claim) => claim.subjectId === subjectId && claim.fact === fact)
    .sort((left, right) => claimRank(right) - claimRank(left))[0];
}

export function deriveProspectNeeds(graph: ResearchGraph, companyId: string, geography?: string): ResearchNeed[] {
  return COMPANY_REQUIRED_FACTS.flatMap((fact) => {
    const claim = bestClaim(graph, companyId, fact);
    if (claim && (claim.state === 'VERIFIED' || claim.state === 'SUPPORTED') && claim.confidence >= 0.7) return [];
    return [{ fact, geography, importance: COMPANY_FACT_IMPORTANCE[fact], subjectId: companyId }];
  });
}

export function graphCompleteness(graph: ResearchGraph, companyId: string): number {
  const resolved = COMPANY_REQUIRED_FACTS.filter((fact) => {
    const claim = bestClaim(graph, companyId, fact);
    return Boolean(claim && (claim.state === 'VERIFIED' || claim.state === 'SUPPORTED') && claim.confidence >= 0.7);
  }).length;
  return resolved / COMPANY_REQUIRED_FACTS.length;
}

function sameClaimValue(left: ResearchClaim, right: ResearchClaim): boolean {
  if (left.objectEntityId || right.objectEntityId) return left.objectEntityId === right.objectEntityId;
  return String(left.value ?? '').trim().toLowerCase() === String(right.value ?? '').trim().toLowerCase();
}

function claimRank(claim: ResearchClaim): number {
  const state = claim.state === 'VERIFIED' ? 4 : claim.state === 'SUPPORTED' ? 3 : claim.state === 'INFERRED' ? 2 : claim.state === 'CONFLICTED' ? 1 : 0;
  return state * 100 + claim.confidence * 100;
}
