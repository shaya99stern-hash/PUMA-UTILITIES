import { addClaim, addEvidence, normalizeLabel } from './graph';
import { searchWeb, type WebSearchResponse } from './web-search';
import type { ResearchFact, ResearchGraph, ResearchTask } from './types';

const DIRECTORY_HOSTS = [
  'linkedin.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com',
  'yelp.com', 'yellowpages.com', 'mapquest.com', 'zillow.com', 'apartments.com',
  'loopnet.com', 'propertyshark.com', 'crunchbase.com', 'bloomberg.com',
];

export function researchQuery(graph: ResearchGraph, task: ResearchTask): string {
  const entity = graph.entities.find((item) => item.id === task.subjectId);
  if (!entity) throw new Error(`Research entity ${task.subjectId} was not found.`);
  const label = `"${entity.label}"`;
  const suffix: Record<ResearchFact, string> = {
    'company.identity': 'property management real estate company',
    'company.website': 'official website',
    'company.phone': 'property management contact phone',
    'company.email': 'property management contact email',
    'company.ownerOperator': 'owner operator owns manages properties',
    'company.portfolio': 'portfolio properties buildings apartments',
    'company.portfolioLowerBound': 'portfolio more than properties buildings communities',
    'person.decisionMaker': 'owner founder principal president CEO COO leadership',
    'person.title': 'title leadership team',
    'person.phone': 'business phone contact',
    'person.email': 'business email contact',
    'property.identity': 'property building parcel',
    'property.owner': 'owner deed LLC property',
    'property.manager': 'property manager management company',
    'property.units': 'apartments units multifamily',
    'property.grossSquareFeet': 'square feet gross floor area building',
    'utility.provider': 'water utility water provider service area',
    'utility.amiCapability': 'water AMI smart meter advanced metering',
    'utility.rateSchedule': 'water rates tariff rate schedule usage charge',
    'utility.buildingMeterStatus': 'water meter smart meter building',
  };
  const geography = task.need.geography ? ` ${task.need.geography}` : '';
  return `${label} ${suffix[task.need.fact]}${geography}`.trim();
}

export async function executeWebDiscovery(
  graph: ResearchGraph,
  task: ResearchTask,
  options: { endpoint?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<WebSearchResponse> {
  const entity = graph.entities.find((item) => item.id === task.subjectId);
  if (!entity) throw new Error(`Research entity ${task.subjectId} was not found.`);
  const query = researchQuery(graph, task);
  const response = await searchWeb(query, { endpoint: options.endpoint, limit: options.limit ?? 10, signal: options.signal });
  const observedAt = new Date().toISOString();

  for (const [index, result] of response.results.entries()) {
    addEvidence(graph, {
      id: `evidence:web:${token(task.id)}:${index}`,
      sourceId: 'open-web-discovery',
      url: result.url,
      observedAt,
      authority: 'discovery-only',
      confidence: Math.max(0.35, 0.58 - index * 0.02),
      excerpt: [result.title, result.snippet].filter(Boolean).join(' — ').slice(0, 600),
    });
  }

  if (entity.kind === 'company' && (task.need.fact === 'company.website' || task.need.fact === 'company.identity')) {
    const candidate = selectLikelyFirstPartyWebsite(entity.label, response);
    if (candidate) {
      addClaim(graph, {
        id: `claim:${entity.id}:website:web-discovery`,
        subjectId: entity.id,
        fact: 'company.website',
        value: new URL(candidate.url).origin,
        state: 'INFERRED',
        confidence: candidate.confidence,
        evidenceIds: [`evidence:web:${token(task.id)}:${candidate.index}`],
        observedAt,
      });
    }
  }
  return response;
}

export function selectLikelyFirstPartyWebsite(companyName: string, response: WebSearchResponse): { url: string; confidence: number; index: number } | undefined {
  const companyTokens = normalizeLabel(companyName).split(' ').filter((token) => token.length >= 3);
  let best: { url: string; score: number; index: number } | undefined;
  response.results.forEach((result, index) => {
    let url: URL;
    try { url = new URL(result.url); } catch { return; }
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (DIRECTORY_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) return;
    const haystack = normalizeLabel(`${result.title} ${result.snippet ?? ''} ${host.replace(/\./g, ' ')}`);
    const matched = companyTokens.filter((token) => haystack.includes(token)).length;
    if (!matched) return;
    const tokenCoverage = matched / Math.max(1, companyTokens.length);
    const rootBonus = url.pathname === '/' || url.pathname === '' ? 0.15 : 0;
    const rankBonus = Math.max(0, 0.12 - index * 0.015);
    const score = Math.min(1, tokenCoverage * 0.7 + rootBonus + rankBonus);
    if (!best || score > best.score) best = { url: result.url, score, index };
  });
  return best && best.score >= 0.48 ? { url: best.url, confidence: Math.min(0.68, best.score), index: best.index } : undefined;
}

function token(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
