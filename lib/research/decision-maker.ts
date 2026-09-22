import type { ResearchClaim, ResearchGraph, SourceAuthority } from './types';

export type RankedDecisionMaker = {
  personId: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  score: number;
  contactStatus: 'email' | 'phone' | 'company-only' | 'none';
  evidenceAuthority: SourceAuthority | 'unknown';
  reasons: string[];
};

export function rankDecisionMakers(graph: ResearchGraph, companyId: string): RankedDecisionMaker[] {
  const companyHasContact = trustedClaims(graph, companyId, 'company.email').length > 0 || trustedClaims(graph, companyId, 'company.phone').length > 0;
  const ids = [...new Set(
    trustedClaims(graph, companyId, 'person.decisionMaker')
      .map((claim) => claim.objectEntityId)
      .filter((value): value is string => Boolean(value))
  )];

  return ids.flatMap((personId): RankedDecisionMaker[] => {
    const entity = graph.entities.find((item) => item.id === personId && item.kind === 'person');
    if (!entity) return [];
    const titleClaim = bestTrustedClaim(graph, personId, 'person.title');
    const emailClaim = bestTrustedClaim(graph, personId, 'person.email');
    const phoneClaim = bestTrustedClaim(graph, personId, 'person.phone');
    const title = typeof titleClaim?.value === 'string' ? titleClaim.value : undefined;
    const email = typeof emailClaim?.value === 'string' ? emailClaim.value : undefined;
    const phone = typeof phoneClaim?.value === 'string' ? phoneClaim.value : undefined;
    const authority = bestAuthority(graph, [titleClaim, emailClaim, phoneClaim].filter(Boolean) as ResearchClaim[]);
    const reasons: string[] = [];
    let score = roleScore(title);

    if (email) {
      score += 24;
      reasons.push('Published business email is sourced.');
    } else if (phone) {
      score += 16;
      reasons.push('Published business phone is sourced.');
    } else if (companyHasContact) {
      score += 6;
      reasons.push('Company-level contact path is available.');
    }

    if (authority === 'official') {
      score += 12;
      reasons.push('Role/contact evidence includes an official source.');
    } else if (authority === 'first-party') {
      score += 9;
      reasons.push('Role/contact evidence includes a first-party source.');
    } else if (authority === 'reputable-secondary') {
      score += 4;
    }

    const roleReason = roleReasonFor(title);
    if (roleReason) reasons.unshift(roleReason);

    return [{
      personId,
      name: entity.label,
      title,
      email,
      phone,
      score: Math.min(100, score),
      contactStatus: email ? 'email' : phone ? 'phone' : companyHasContact ? 'company-only' : 'none',
      evidenceAuthority: authority,
      reasons,
    }];
  }).sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
}

function roleScore(title?: string): number {
  const value = title?.toLowerCase() ?? '';
  if (/owner|founder|managing principal|managing partner|principal/.test(value)) return 68;
  if (/chief operating officer|coo|head of operations|director of operations|operations/.test(value)) return 64;
  if (/chief executive officer|ceo|president/.test(value)) return 60;
  if (/facilities|property management|property manager|asset management|asset manager/.test(value)) return 58;
  if (/acquisition|development|vice president|\bvp\b/.test(value)) return 45;
  if (/chief financial officer|cfo|finance|controller/.test(value)) return 38;
  if (/marketing|communications|human resources|people/.test(value)) return 20;
  return title ? 30 : 12;
}

function roleReasonFor(title?: string): string | undefined {
  if (!title) return undefined;
  if (/owner|founder|managing principal|managing partner|principal/i.test(title)) return 'Ownership/principal role is close to final operating decisions.';
  if (/operat|facilit|property manage|asset manage/i.test(title)) return 'Operational role is directly relevant to building and utility decisions.';
  if (/chief executive|ceo|president/i.test(title)) return 'Senior executive role can sponsor an operating decision.';
  return 'Sourced role: ' + title + '.';
}

function trustedClaims(graph: ResearchGraph, subjectId: string, fact: ResearchClaim['fact']): ResearchClaim[] {
  return graph.claims.filter((claim) =>
    claim.subjectId === subjectId &&
    claim.fact === fact &&
    trusted(claim)
  );
}

function bestTrustedClaim(graph: ResearchGraph, subjectId: string, fact: ResearchClaim['fact']): ResearchClaim | undefined {
  return trustedClaims(graph, subjectId, fact)
    .sort((a, b) => rankClaim(graph, b) - rankClaim(graph, a))[0];
}

function trusted(claim: ResearchClaim): boolean {
  return (claim.state === 'VERIFIED' || claim.state === 'SUPPORTED') && claim.confidence >= 0.7;
}

function rankClaim(graph: ResearchGraph, claim: ResearchClaim): number {
  const authority = bestAuthority(graph, [claim]);
  const authorityScore = authority === 'official' ? 4 : authority === 'first-party' ? 3 : authority === 'reputable-secondary' ? 2 : 1;
  return authorityScore * 100 + claim.confidence * 100;
}

function bestAuthority(graph: ResearchGraph, claims: ResearchClaim[]): SourceAuthority | 'unknown' {
  const order: SourceAuthority[] = ['official', 'first-party', 'reputable-secondary', 'discovery-only'];
  for (const authority of order) {
    if (claims.some((claim) =>
      claim.evidenceIds.some((id) => graph.evidence.find((item) => item.id === id)?.authority === authority)
    )) return authority;
  }
  return 'unknown';
}
