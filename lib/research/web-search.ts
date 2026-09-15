export interface WebSearchResult {
  title: string;
  url: string;
  snippet?: string;
  engine?: string;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
  backend: 'searxng';
}

export interface WebSearchOptions {
  endpoint?: string;
  limit?: number;
  signal?: AbortSignal;
}

/**
 * Puma's default general-web discovery backend is a user-controlled SearXNG
 * instance. This avoids a per-query commercial API dependency while keeping
 * the search layer swappable. The deployment must provide PUMA_SEARXNG_URL.
 */
export async function searchWeb(query: string, options: WebSearchOptions = {}): Promise<WebSearchResponse> {
  const endpoint = options.endpoint ?? process.env.PUMA_SEARXNG_URL;
  if (!endpoint) throw new Error('Web discovery is not configured. Set PUMA_SEARXNG_URL to a trusted SearXNG instance.');
  const safeEndpoint = validateSearchEndpoint(endpoint);
  const limit = Math.max(1, Math.min(30, Math.floor(options.limit ?? 10)));
  const url = new URL('/search', safeEndpoint);
  url.searchParams.set('q', query.trim());
  url.searchParams.set('format', 'json');
  url.searchParams.set('language', 'en-US');
  url.searchParams.set('safesearch', '1');

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json', 'User-Agent': 'PumaUtilitiesResearch/1.0' },
    cache: 'no-store',
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`Web discovery failed with ${response.status}.`);
  const payload = await response.json() as { results?: Array<Record<string, unknown>> };
  const results = (payload.results ?? [])
    .flatMap((row): WebSearchResult[] => {
      const title = typeof row.title === 'string' ? row.title.trim() : '';
      const rawUrl = typeof row.url === 'string' ? row.url.trim() : '';
      if (!title || !rawUrl || !isPublicHttpUrl(rawUrl)) return [];
      return [{
        title,
        url: rawUrl,
        snippet: typeof row.content === 'string' ? row.content.trim() : undefined,
        engine: typeof row.engine === 'string' ? row.engine : undefined,
      }];
    })
    .slice(0, limit);

  return { query, results, backend: 'searxng' };
}

export function validateSearchEndpoint(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Search endpoint must use HTTP(S).');
  if (isBlockedHost(url.hostname)) throw new Error('Search endpoint cannot target localhost or a private-address literal.');
  return url;
}

export function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !isBlockedHost(url.hostname);
  } catch {
    return false;
  }
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host)) return true;
  const private172 = host.match(/^172\.(\d{1,3})\./);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return true;
  return false;
}
