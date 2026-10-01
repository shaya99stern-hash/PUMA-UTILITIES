/**
 * Optional web search providers (configured by env key). Keyless search engines block cloud IPs,
 * so without a key the engine falls back to keyless domain guessing in website.ts.
 */
import { fetchJson } from '../http';
import type { SourceInfo } from '../types';
import type { FetchCtx } from './common';

export const webSearch: SourceInfo = {
  id: 'web-search',
  name: 'Web search (Brave / Serper / Google CSE)',
  kind: 'enrichment',
  coverage: ['WEB'],
  coverageLabel: 'Web',
  capabilities: ['find_website', 'find_linkedin'],
  description: 'Finds company websites and LinkedIn pages when an API key is configured (BRAVE_SEARCH_API_KEY, SERPER_API_KEY or GOOGLE_CSE_KEY + GOOGLE_CSE_CX).',
  homepage: 'https://brave.com/search/api/',
  verified: 'needs-key',
  requiresEnv: ['BRAVE_SEARCH_API_KEY', 'SERPER_API_KEY', 'GOOGLE_CSE_KEY'],
};

export type SearchHit = { title: string; url: string; snippet: string; provider: string };

export function searchProvider(): 'brave' | 'serper' | 'google' | null {
  if (process.env.BRAVE_SEARCH_API_KEY?.trim()) return 'brave';
  if (process.env.SERPER_API_KEY?.trim()) return 'serper';
  if (process.env.GOOGLE_CSE_KEY?.trim() && process.env.GOOGLE_CSE_CX?.trim()) return 'google';
  return null;
}

export function parseBrave(data: { web?: { results?: { title?: string; url?: string; description?: string }[] } }): SearchHit[] {
  return (data.web?.results ?? []).flatMap((r) => (r.url ? [{ title: r.title ?? '', url: r.url, snippet: (r.description ?? '').replace(/<[^>]+>/g, ''), provider: 'brave' }] : []));
}
export function parseSerper(data: { organic?: { title?: string; link?: string; snippet?: string }[] }): SearchHit[] {
  return (data.organic ?? []).flatMap((r) => (r.link ? [{ title: r.title ?? '', url: r.link, snippet: r.snippet ?? '', provider: 'serper' }] : []));
}
export function parseGoogleCse(data: { items?: { title?: string; link?: string; snippet?: string }[] }): SearchHit[] {
  return (data.items ?? []).flatMap((r) => (r.link ? [{ title: r.title ?? '', url: r.link, snippet: r.snippet ?? '', provider: 'google' }] : []));
}

export async function search(query: string, ctx: FetchCtx, count = 8): Promise<SearchHit[]> {
  const provider = searchProvider();
  if (!provider) return [];
  const common = { sourceId: webSearch.id, deadline: ctx.deadline, timeoutMs: 10_000, retries: 1, ttlMs: 14 * 24 * 3_600_000 };
  if (provider === 'brave') {
    const url = `https://api.search.brave.com/res/v1/web/search?count=${count}&q=${encodeURIComponent(query)}`;
    const { data } = await fetchJson<Parameters<typeof parseBrave>[0]>({ ...common, url, headers: { 'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY!.trim(), Accept: 'application/json' } });
    return parseBrave(data);
  }
  if (provider === 'serper') {
    const { data } = await fetchJson<Parameters<typeof parseSerper>[0]>({
      ...common,
      url: 'https://google.serper.dev/search',
      method: 'POST',
      body: JSON.stringify({ q: query, num: count }),
      headers: { 'X-API-KEY': process.env.SERPER_API_KEY!.trim(), 'Content-Type': 'application/json' },
    });
    return parseSerper(data);
  }
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(process.env.GOOGLE_CSE_KEY!.trim())}&cx=${encodeURIComponent(process.env.GOOGLE_CSE_CX!.trim())}&num=${Math.min(10, count)}&q=${encodeURIComponent(query)}`;
  const { data } = await fetchJson<Parameters<typeof parseGoogleCse>[0]>({ ...common, url });
  return parseGoogleCse(data);
}
