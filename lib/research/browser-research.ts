import { addClaim, addEvidence, normalizeLabel, upsertEntity } from './graph';
import { validateSearchEndpoint } from './web-search';
import type { ResearchGraph, ResearchTask } from './types';

type BrowserPerson = {
  name?: string;
  title?: string;
  sourceUrl?: string;
  visibility?: 'public' | 'restricted' | string;
};

type BrowserResearchResponse = {
  people?: BrowserPerson[];
  sourceUrl?: string;
};

export async function executeBrowserDirectoryResearch(
  graph: ResearchGraph,
  task: ResearchTask,
  options: { signal?: AbortSignal } = {},
): Promise<{ peopleAdded: number; message: string }> {
  const endpoint = process.env.PUMA_BROWSER_RESEARCH_URL;
  const token = process.env.PUMA_BROWSER_RESEARCH_TOKEN;
  if (!endpoint || !token) throw new Error('Browser enrichment is not configured. Set PUMA_BROWSER_RESEARCH_URL and PUMA_BROWSER_RESEARCH_TOKEN for the authorized Playwright worker.');
  const safeEndpoint = validateSearchEndpoint(endpoint);
  const entity = graph.entities.find((item) => item.id === task.subjectId);
  if (!entity || entity.kind !== 'company') throw new Error('Contact directory research requires a company entity.');

  const response = await fetch(safeEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      adapter: 'contactout-public-directory',
      company: entity.label,
      geography: entity.geography,
      goal: 'Return only publicly visible employee names and roles relevant to ownership, executive leadership, operations, facilities, property management, or asset management. Do not reveal or bypass credit-gated contact data.',
      maxPeople: 20,
    }),
    cache: 'no-store',
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`Browser enrichment failed with ${response.status}.`);
  const payload = await response.json() as BrowserResearchResponse;
  let peopleAdded = 0;

  for (const person of payload.people ?? []) {
    const name = person.name?.trim();
    const title = person.title?.trim();
    const sourceUrl = person.sourceUrl?.trim() || payload.sourceUrl?.trim();
    if (!name || !title || !sourceUrl || person.visibility !== 'public') continue;
    const personId = `person:directory:${stableToken(entity.id)}:${stableToken(name)}`;
    const evidenceId = `evidence:contactout:${stableToken(entity.id)}:${stableToken(name + title)}`;
    const observedAt = new Date().toISOString();

    upsertEntity(graph, { id: personId, kind: 'person', label: name, geography: entity.geography });
    addEvidence(graph, {
      id: evidenceId,
      sourceId: 'contactout-public-directory',
      url: sourceUrl,
      observedAt,
      authority: 'reputable-secondary',
      confidence: 0.7,
      excerpt: `${name} — ${title}`,
    });
    addClaim(graph, {
      id: `claim:${personId}:title:contactout`,
      subjectId: personId,
      fact: 'person.title',
      value: title,
      state: 'SUPPORTED',
      confidence: 0.72,
      evidenceIds: [evidenceId],
      observedAt,
    });
    if (/owner|founder|principal|chair|president|chief|ceo|coo|partner|operations|property management|asset management|facilities/i.test(title)) {
      addClaim(graph, {
        id: `claim:${entity.id}:decision-maker:contactout:${stableToken(name)}`,
        subjectId: entity.id,
        fact: 'person.decisionMaker',
        objectEntityId: personId,
        state: 'SUPPORTED',
        confidence: 0.7,
        evidenceIds: [evidenceId],
        observedAt,
      });
    }
    peopleAdded += 1;
  }

  return { peopleAdded, message: `Browser directory enrichment added ${peopleAdded} public person record(s).` };
}

function stableToken(value: string): string {
  const normalized = normalizeLabel(value) || value.toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
