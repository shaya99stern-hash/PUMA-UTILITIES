import { normalizeLabel } from './graph';
import type { ResearchClaim, ResearchGraph } from './types';

export function equivalentCompanyEntityIds(graph: ResearchGraph, companyId: string): Set<string> {
  const root = graph.entities.find((entity) => entity.id === companyId && entity.kind === 'company');
  if (!root) return new Set([companyId]);

  const labels = new Set<string>();
  const add = (value?: string) => {
    if (!value) return;
    const normalized = normalizeLabel(value);
    if (normalized) labels.add(normalized);
  };
  add(root.label);
  for (const alias of root.aliases ?? []) add(alias);
  for (const claim of trustedClaims(graph, companyId, 'company.identity')) {
    if (typeof claim.value === 'string') add(claim.value);
  }

  const ids = new Set<string>([companyId]);
  for (const entity of graph.entities) {
    if (entity.kind !== 'company' && entity.kind !== 'organization') continue;
    const candidates = [entity.label, ...(entity.aliases ?? [])].map(normalizeLabel).filter(Boolean);
    if (candidates.some((label) => labels.has(label))) ids.add(entity.id);
    for (const claim of trustedClaims(graph, entity.id, 'company.identity')) {
      if (typeof claim.value === 'string' && labels.has(normalizeLabel(claim.value))) ids.add(entity.id);
    }
  }
  return ids;
}

export function linkedCompanyPropertyIds(graph: ResearchGraph, companyId: string): string[] {
  const companyIds = equivalentCompanyEntityIds(graph, companyId);
  const ids = new Set<string>();
  for (const claim of graph.claims) {
    if ((claim.fact !== 'property.owner' && claim.fact !== 'property.manager') || !claim.objectEntityId || !trusted(claim)) continue;
    if (!companyIds.has(claim.objectEntityId)) continue;
    const property = graph.entities.find((entity) => entity.id === claim.subjectId && entity.kind === 'property');
    if (property) ids.add(property.id);
  }
  return [...ids].sort();
}

function trustedClaims(graph: ResearchGraph, subjectId: string, fact: ResearchClaim['fact']): ResearchClaim[] {
  return graph.claims.filter((claim) => claim.subjectId === subjectId && claim.fact === fact && trusted(claim));
}

function trusted(claim: ResearchClaim): boolean {
  return (claim.state === 'VERIFIED' || claim.state === 'SUPPORTED') && claim.confidence >= 0.7;
}
