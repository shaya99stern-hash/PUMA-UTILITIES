import { addClaim, addEvidence, normalizeLabel } from '../graph';
import { assertPublicNetworkTarget } from '../network-safety';
import type { ResearchGraph } from '../types';
import { isPublicHttpUrl, searchWeb } from '../web-search';

const PATHS = ['/', '/rates', '/water-rates', '/rate-schedule', '/tariffs', '/smart-meter', '/smart-meters', '/ami', '/metering', '/meters', '/customer-service'];
const DIRECTORY_HOSTS = ['facebook.com','linkedin.com','instagram.com','youtube.com','yelp.com','wikipedia.org','mapquest.com'];

export type UtilityWebSignal = {
  text: string;
  sourceUrl: string;
};

export type UtilityWebsiteResearch = {
  seedUrl?: string;
  visitedUrls: string[];
  amiSignals: UtilityWebSignal[];
  rateSignals: UtilityWebSignal[];
  warnings: string[];
};

export async function researchUtilityWebsite(
  provider: string,
  options: { maxPages?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<UtilityWebsiteResearch> {
  const search = await searchWeb(`"${provider}" official water utility rates tariff smart meter AMI`, {
    limit: 10,
    signal: options.signal,
  });
  const seed = selectLikelyUtilityWebsite(provider, search.results);
  if (!seed) return { visitedUrls: [], amiSignals: [], rateSignals: [], warnings: ['No credible first-party utility website candidate was found.'] };

  const origin = new URL(seed).origin;
  const maxPages = Math.max(1, Math.min(12, Math.floor(options.maxPages ?? 8)));
  const timeoutMs = Math.max(1000, Math.min(15_000, Math.floor(options.timeoutMs ?? 7000)));
  const queue = PATHS.map((path) => new URL(path, origin).toString());
  const visited = new Set<string>();
  const ami = new Map<string, UtilityWebSignal>();
  const rates = new Map<string, UtilityWebSignal>();
  const warnings: string[] = [];

  while (queue.length && visited.size < maxPages) {
    const next = queue.shift();
    if (!next || visited.has(next)) continue;
    visited.add(next);
    try {
      const { html, finalUrl } = await fetchHtml(next, timeoutMs, options.signal);
      const text = htmlToText(html);
      for (const signal of extractAmiSignals(text, finalUrl)) ami.set(`${finalUrl}:${signal.text}`, signal);
      for (const signal of extractRateSignals(text, finalUrl)) rates.set(`${finalUrl}:${signal.text}`, signal);
      for (const discovered of extractLikelyUtilityPages(html, origin)) {
        if (!visited.has(discovered) && !queue.includes(discovered) && queue.length < maxPages * 3) queue.push(discovered);
      }
    } catch (error) {
      warnings.push(`${next}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    seedUrl: origin,
    visitedUrls: [...visited],
    amiSignals: [...ami.values()].slice(0, 20),
    rateSignals: [...rates.values()].slice(0, 20),
    warnings,
  };
}

export function ingestUtilityWebsite(
  graph: ResearchGraph,
  utilityId: string,
  research: UtilityWebsiteResearch,
  observedAt = new Date().toISOString(),
): void {
  if (!research.seedUrl) return;

  for (const [index, signal] of research.amiSignals.entries()) {
    const evidenceId = `evidence:utility-ami:${token(utilityId)}:${index}`;
    addEvidence(graph, {
      id: evidenceId,
      sourceId: 'utility-first-party-web',
      url: signal.sourceUrl,
      observedAt,
      authority: 'first-party',
      confidence: 0.9,
      excerpt: signal.text.slice(0, 600),
    });
    addClaim(graph, {
      id: `claim:${utilityId}:ami:first-party:${index}`,
      subjectId: utilityId,
      fact: 'utility.amiCapability',
      value: signal.text.slice(0, 500),
      state: 'SUPPORTED',
      confidence: 0.86,
      evidenceIds: [evidenceId],
      observedAt,
    });
  }

  for (const [index, signal] of research.rateSignals.entries()) {
    const evidenceId = `evidence:utility-rate:${token(utilityId)}:${index}`;
    addEvidence(graph, {
      id: evidenceId,
      sourceId: 'utility-first-party-web',
      url: signal.sourceUrl,
      observedAt,
      authority: 'first-party',
      confidence: 0.9,
      excerpt: signal.text.slice(0, 600),
    });
    addClaim(graph, {
      id: `claim:${utilityId}:rate:first-party:${index}`,
      subjectId: utilityId,
      fact: 'utility.rateSchedule',
      value: signal.text.slice(0, 500),
      state: 'SUPPORTED',
      confidence: 0.84,
      evidenceIds: [evidenceId],
      observedAt,
    });
  }
}

export function selectLikelyUtilityWebsite(provider: string, results: Array<{ title: string; url: string; snippet?: string }>): string | undefined {
  const tokens = normalizeLabel(provider).split(' ').filter((token) => token.length >= 3 && !['water','utility','utilities','authority','department','company'].includes(token));
  let best: { url: string; score: number } | undefined;

  for (const [index, result] of results.entries()) {
    let url: URL;
    try { url = new URL(result.url); } catch { continue; }
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (DIRECTORY_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) continue;
    const haystack = normalizeLabel(`${result.title} ${result.snippet ?? ''} ${host.replace(/\./g, ' ')}`);
    const matched = tokens.filter((token) => haystack.includes(token)).length;
    const coverage = tokens.length ? matched / tokens.length : 0;
    const officialBonus = /\.gov$|\.us$/.test(host) ? 0.18 : 0;
    const rankBonus = Math.max(0, 0.12 - index * 0.015);
    const score = coverage * 0.72 + officialBonus + rankBonus;
    if (!best || score > best.score) best = { url: url.origin, score };
  }

  return best && best.score >= 0.38 ? best.url : undefined;
}

export function extractAmiSignals(text: string, sourceUrl: string): UtilityWebSignal[] {
  return signalLines(text, /\b(advanced metering infrastructure|AMI|automated meter reading|AMR|smart (?:water )?meters?|advanced meters?)\b/i, sourceUrl);
}

export function extractRateSignals(text: string, sourceUrl: string): UtilityWebSignal[] {
  const lines = text.split(/\n+/).map((line) => line.replace(/\s+/g, ' ').trim()).filter((line) => line.length >= 8 && line.length <= 500);
  return lines
    .filter((line) =>
      /\b(water rate|rate schedule|tariff|usage charge|base charge|service charge)\b/i.test(line) ||
      (/\$\s*\d/.test(line) && /\b(gallon|1,?000\s*gal|ccf|cubic feet|meter|monthly|quarterly|rate)\b/i.test(line))
    )
    .slice(0, 20)
    .map((text) => ({ text, sourceUrl }));
}

function signalLines(text: string, pattern: RegExp, sourceUrl: string): UtilityWebSignal[] {
  return text.split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 8 && line.length <= 500 && pattern.test(line))
    .slice(0, 20)
    .map((text) => ({ text, sourceUrl }));
}

async function fetchHtml(url: string, timeoutMs: number, outerSignal?: AbortSignal): Promise<{ html: string; finalUrl: string }> {
  if (!isPublicHttpUrl(url)) throw new Error('Refused non-public URL.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  outerSignal?.addEventListener('abort', abort, { once: true });

  try {
    let current = url;
    for (let redirects = 0; redirects <= 4; redirects += 1) {
      if (!isPublicHttpUrl(current)) throw new Error('Refused redirect to non-public URL.');
      await assertPublicNetworkTarget(current);
      const response = await fetch(current, {
        headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'PumaUtilitiesResearch/1.1 (+public utility research)' },
        redirect: 'manual',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error(`Redirect ${response.status} had no location.`);
        current = new URL(location, current).toString();
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) throw new Error('Not an HTML page.');
      const length = Number(response.headers.get('content-length') ?? 0);
      if (length > 2_000_000) throw new Error('Page is too large to crawl safely.');
      return { html: (await response.text()).slice(0, 2_000_000), finalUrl: current };
    }
    throw new Error('Too many redirects.');
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener('abort', abort);
  }
}

function extractLikelyUtilityPages(html: string, origin: string): string[] {
  const output = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const url = new URL(match[1], origin);
      if (url.origin !== origin || !isPublicHttpUrl(url.toString())) continue;
      if (/\b(rate|tariff|meter|ami|billing|customer|water)\b/i.test(url.pathname)) {
        url.hash = '';
        output.add(url.toString());
      }
    } catch {
      // Ignore malformed links.
    }
  }
  return [...output];
}

function htmlToText(html: string): string {
  return html
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|p|div|li|h1|h2|h3|h4|section|article|tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

function token(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
