export interface WebSearchResult {
  title: string;
  url: string;
  snippet?: string;
  engine?: string;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
  backend: 'searxng' | 'duckduckgo-html';
}

export interface WebSearchOptions {
  endpoint?: string;
  limit?: number;
  signal?: AbortSignal;
}

/**
 * Prefer a user-controlled SearXNG endpoint when configured. Otherwise use a
 * bounded public DuckDuckGo HTML fallback so lead discovery remains usable
 * without a required commercial search API or another deployed service.
 */
export async function searchWeb(query: string, options: WebSearchOptions = {}): Promise<WebSearchResponse> {
  const cleanQuery = query.trim().slice(0, 500);
  if (!cleanQuery) throw new Error('Web discovery query is empty.');
  const limit = Math.max(1, Math.min(30, Math.floor(options.limit ?? 10)));
  const endpoint = options.endpoint ?? process.env.PUMA_SEARXNG_URL;
  if (endpoint) return searchSearxng(cleanQuery, endpoint, limit, options.signal);
  return searchDuckDuckGo(cleanQuery, limit, options.signal);
}

async function searchSearxng(query: string, endpoint: string, limit: number, signal?: AbortSignal): Promise<WebSearchResponse> {
  const safeEndpoint = validateSearchEndpoint(endpoint);
  const url = new URL('/search', safeEndpoint);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('language', 'en-US');
  url.searchParams.set('safesearch', '1');

  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: { Accept: 'application/json', 'User-Agent': 'PumaUtilitiesResearch/1.1' },
    cache: 'no-store',
  }, signal);
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

async function searchDuckDuckGo(query: string, limit: number, signal?: AbortSignal): Promise<WebSearchResponse> {
  const body = new URLSearchParams({ q: query, kl: 'us-en', kp: '1' });
  const response = await fetchWithTimeout('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (compatible; PumaUtilitiesResearch/1.1; +public business research)',
    },
    body,
    cache: 'no-store',
  }, signal);
  if (!response.ok) throw new Error(`Built-in web discovery failed with ${response.status}.`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > 2_000_000) throw new Error('Built-in web discovery response was too large.');
  const html = (await response.text()).slice(0, 2_000_000);
  return { query, results: parseDuckDuckGoHtml(html).slice(0, limit), backend: 'duckduckgo-html' };
}

export function parseDuckDuckGoHtml(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const blocks = html.split(/<div[^>]+class=["'][^"']*result[^"']*["'][^>]*>/i).slice(1);
  for (const block of blocks) {
    const anchor = block.match(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
      ?? block.match(/<a[^>]+href=["']([^"']+)["'][^>]*class=["'][^"']*result-link[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;
    const rawUrl = unwrapDuckDuckGoUrl(decodeHtml(anchor[1]));
    const title = stripHtml(anchor[2]);
    if (!title || !rawUrl || !isPublicHttpUrl(rawUrl)) continue;
    const snippetMatch = block.match(/<(?:a|div)[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : undefined;
    if (results.some((item) => item.url === rawUrl)) continue;
    results.push({ title, url: rawUrl, snippet, engine: 'duckduckgo-html' });
  }
  return results;
}

function unwrapDuckDuckGoUrl(value: string): string {
  try {
    const url = new URL(value, 'https://duckduckgo.com');
    const unwrapped = url.searchParams.get('uddg');
    return unwrapped || url.toString();
  } catch {
    return value;
  }
}

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#x3A;/gi, ':');
}

async function fetchWithTimeout(input: string | URL, init: RequestInit, outerSignal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const abort = () => controller.abort();
  outerSignal?.addEventListener('abort', abort, { once: true });
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener('abort', abort);
  }
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
