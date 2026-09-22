import { addClaim, addEvidence, bestClaim, normalizeLabel } from '../graph';
import { assertPublicNetworkTarget } from '../network-safety';
import type { ResearchGraph } from '../types';
import { isPublicHttpUrl, searchWeb } from '../web-search';
import { extractContacts, extractLeadershipSignals } from './company-website';

export async function resolvePersonFromCompanySite(
  graph: ResearchGraph,
  personId: string,
  signal?: AbortSignal,
): Promise<{ pages: number; contacts: number; titles: number; message: string }> {
  const person = graph.entities.find((entity) => entity.id === personId && entity.kind === 'person');
  if (!person) throw new Error('Person entity was not found.');
  const companyClaim = graph.claims.find((claim) => claim.fact === 'person.decisionMaker' && claim.objectEntityId === personId);
  if (!companyClaim) throw new Error('No parent company relationship is available for this person.');
  const company = graph.entities.find((entity) => entity.id === companyClaim.subjectId && entity.kind === 'company');
  if (!company) throw new Error('Parent company entity was not found.');
  const website = bestClaim(graph, company.id, 'company.website');
  if (typeof website?.value !== 'string') throw new Error('Parent company website is unresolved.');

  const origin = new URL(website.value).origin;
  const host = new URL(origin).hostname.replace(/^www\./, '');
  const search = await searchWeb('site:' + host + ' "' + person.label + '" email phone leadership contact', { limit: 8, signal });
  const urls = [...new Set(search.results.flatMap((item) => {
    try {
      const url = new URL(item.url);
      return url.hostname.replace(/^www\./, '') === host ? [url.toString()] : [];
    } catch {
      return [];
    }
  }))].slice(0, 4);

  let contactsAdded = 0;
  let titlesAdded = 0;
  let pages = 0;
  for (const url of urls) {
    const html = await fetchHtml(url, signal);
    pages += 1;
    const evidenceId = 'evidence:person-first-party:' + token(personId) + ':' + token(url);
    addEvidence(graph, {
      id: evidenceId,
      sourceId: 'person-company-first-party',
      url,
      observedAt: new Date().toISOString(),
      authority: 'first-party',
      confidence: 0.88,
    });

    for (const contact of extractContacts(html, url)) {
      if (!contextMatches(contact.context, person.label)) continue;
      addClaim(graph, {
        id: 'claim:' + personId + ':' + contact.type + ':first-party:' + token(contact.value),
        subjectId: personId,
        fact: contact.type === 'email' ? 'person.email' : 'person.phone',
        value: contact.value,
        state: 'SUPPORTED',
        confidence: 0.86,
        evidenceIds: [evidenceId],
        observedAt: new Date().toISOString(),
      });
      contactsAdded += 1;
    }

    for (const leadership of extractLeadershipSignals(html, url)) {
      if (!normalizeLabel(leadership.text).includes(normalizeLabel(person.label))) continue;
      const title = extractTitle(leadership.text, person.label);
      if (!title) continue;
      addClaim(graph, {
        id: 'claim:' + personId + ':title:first-party:' + token(title),
        subjectId: personId,
        fact: 'person.title',
        value: title,
        state: 'SUPPORTED',
        confidence: 0.84,
        evidenceIds: [evidenceId],
        observedAt: new Date().toISOString(),
      });
      titlesAdded += 1;
    }
  }

  return {
    pages,
    contacts: contactsAdded,
    titles: titlesAdded,
    message: 'Checked ' + pages + ' first-party person page(s); added ' + contactsAdded + ' contact claim(s) and ' + titlesAdded + ' title claim(s).',
  };
}

function contextMatches(context: string | undefined, name: string): boolean {
  if (!context) return false;
  const haystack = normalizeLabel(context);
  const tokens = normalizeLabel(name).split(' ').filter((token) => token.length >= 3);
  return tokens.length >= 2 && tokens.every((token) => haystack.includes(token));
}

function extractTitle(text: string, name: string): string | undefined {
  const withoutName = text.replace(new RegExp(escapeRegex(name), 'i'), ' ').replace(/^[\s—–|,:-]+|[\s—–|,:-]+$/g, '').trim();
  const match = withoutName.match(/\b(owner|founder|principal|managing principal|managing partner|president|chief executive officer|ceo|chief operating officer|coo|chief property officer|chief financial officer|cfo|head of property management|regional property manager|property manager|director of asset management|asset manager|director of operations|vice president(?: of operations| of property management| of asset management)?|director of facilities|facilities director)\b/i);
  return match?.[0];
}

async function fetchHtml(url: string, signal?: AbortSignal): Promise<string> {
  if (!isPublicHttpUrl(url)) throw new Error('Refused non-public person URL.');
  const allowedHost = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  let current = url;
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    if (!isPublicHttpUrl(current)) throw new Error('Refused non-public person URL.');
    const currentUrl = new URL(current);
    if (currentUrl.hostname.toLowerCase().replace(/^www\./, '') !== allowedHost) throw new Error('Refused cross-host person redirect.');
    await assertPublicNetworkTarget(current);
    const response = await fetch(current, {
      headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'PumaUtilitiesResearch/1.3 public business research' },
      redirect: 'manual',
      cache: 'no-store',
      signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Person redirect ' + response.status + ' had no location.');
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw new Error('First-party person page returned ' + response.status + '.');
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) throw new Error('Person page was not HTML.');
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > 2_000_000) throw new Error('Person page exceeded safe crawl size.');
    return (await response.text()).slice(0, 2_000_000);
  }
  throw new Error('Too many person-page redirects.');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
}

function token(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
