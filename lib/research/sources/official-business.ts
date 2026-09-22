import { addClaim, addEvidence, normalizeLabel } from '../graph';
import type { ResearchGraph } from '../types';
import { searchWeb } from '../web-search';

const SOURCE_CONFIG: Record<string, { domains: string[]; agency: string }> = {
  'nys-dos-business': { domains: ['dos.ny.gov', 'apps.dos.ny.gov'], agency: 'New York Department of State' },
  'nj-dores-business': { domains: ['nj.gov', 'njportal.com'], agency: 'New Jersey Division of Revenue' },
  'pa-dos-business': { domains: ['pa.gov'], agency: 'Pennsylvania Department of State' },
};

export async function researchOfficialBusinessIdentity(
  graph: ResearchGraph,
  companyId: string,
  sourceId: string,
  signal?: AbortSignal,
): Promise<{ matched: number; message: string }> {
  const company = graph.entities.find((entity) => entity.id === companyId && entity.kind === 'company');
  const config = SOURCE_CONFIG[sourceId];
  if (!company || !config) throw new Error('Unsupported official business-record source.');

  const response = await searchWeb(`"${company.label}" ${config.agency} business entity`, { limit: 10, signal });
  const wanted = normalizeLabel(company.label);
  const wantedTokens = wanted.split(' ').filter((token) => token.length >= 3);
  let matched = 0;

  for (const [index, result] of response.results.entries()) {
    let url: URL;
    try { url = new URL(result.url); } catch { continue; }
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!config.domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) continue;

    const haystack = normalizeLabel(`${result.title} ${result.snippet ?? ''}`);
    const coverage = wantedTokens.length
      ? wantedTokens.filter((token) => haystack.includes(token)).length / wantedTokens.length
      : 0;
    if (coverage < 0.75) continue;

    const evidenceId = `evidence:${sourceId}:${token(company.label)}:${index}`;
    const observedAt = new Date().toISOString();
    addEvidence(graph, {
      id: evidenceId,
      sourceId,
      url: result.url,
      observedAt,
      authority: 'official',
      confidence: Math.min(0.9, 0.72 + coverage * 0.18),
      excerpt: [result.title, result.snippet].filter(Boolean).join(' — ').slice(0, 600),
    });
    addClaim(graph, {
      id: `claim:${companyId}:identity:${sourceId}:${index}`,
      subjectId: companyId,
      fact: 'company.identity',
      value: company.label,
      state: 'SUPPORTED',
      confidence: Math.min(0.88, 0.7 + coverage * 0.18),
      evidenceIds: [evidenceId],
      observedAt,
    });
    matched += 1;
  }

  return {
    matched,
    message: matched
      ? `${sourceId} returned ${matched} official-domain identity match(es).`
      : `${sourceId} returned no sufficiently specific official-domain match.`,
  };
}

function token(value: string): string {
  let hash = 2166136261;
  const normalized = normalizeLabel(value) || value.toLowerCase();
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
