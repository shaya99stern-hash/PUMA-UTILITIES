import { assertPublicNetworkTarget } from '../network-safety';
import { isPublicHttpUrl } from '../web-search';

const DEFAULT_PATHS = ['/', '/about', '/about-us', '/team', '/leadership', '/management', '/properties', '/portfolio', '/contact', '/contact-us'];
const DECISION_TITLES = /\b(owner|founder|principal|managing principal|managing partner|president|chief executive officer|ceo|chief operating officer|coo|head of property management|property manager|asset manager|director of operations|vice president)\b/i;

export interface WebsiteContact {
  type: 'email' | 'phone';
  value: string;
  sourceUrl: string;
  context?: string;
}

export interface WebsiteLeadershipSignal {
  text: string;
  sourceUrl: string;
}

export interface WebsitePropertySignal {
  address: string;
  state?: string;
  sourceUrl: string;
}

export interface CompanyWebsiteResearch {
  seedUrl: string;
  visitedUrls: string[];
  contacts: WebsiteContact[];
  leadershipSignals: WebsiteLeadershipSignal[];
  propertySignals?: WebsitePropertySignal[];
  socialUrls: string[];
  warnings: string[];
}

export async function crawlCompanyWebsite(
  seedUrl: string,
  options: { maxPages?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<CompanyWebsiteResearch> {
  if (!isPublicHttpUrl(seedUrl)) throw new Error('Company website must be a public HTTP(S) URL.');
  const seed = new URL(seedUrl);
  const maxPages = Math.max(1, Math.min(10, Math.floor(options.maxPages ?? 6)));
  const timeoutMs = Math.max(1000, Math.min(15_000, Math.floor(options.timeoutMs ?? 7000)));
  const queue = prioritizedUrls(seed).slice(0, maxPages * 2);
  const visited = new Set<string>();
  const contacts = new Map<string, WebsiteContact>();
  const leadershipSignals = new Map<string, WebsiteLeadershipSignal>();
  const socialUrls = new Set<string>();
  const propertySignals = new Map<string, WebsitePropertySignal>();
  const warnings: string[] = [];

  while (queue.length && visited.size < maxPages) {
    const next = queue.shift();
    if (!next || visited.has(next)) continue;
    visited.add(next);
    try {
      const { html, finalUrl } = await fetchHtml(next, timeoutMs, options.signal);
      for (const contact of extractContacts(html, finalUrl)) contacts.set(`${contact.type}:${contact.value}`, contact);
      for (const signal of extractLeadershipSignals(html, finalUrl)) leadershipSignals.set(`${finalUrl}:${signal.text}`, signal);
      for (const property of extractPropertySignals(html, finalUrl)) propertySignals.set(property.address.toLowerCase(), property);
      for (const social of extractSocialUrls(html)) socialUrls.add(social);

      for (const discovered of extractLikelyInternalPages(html, seed)) {
        if (!visited.has(discovered) && !queue.includes(discovered) && queue.length < maxPages * 3) queue.push(discovered);
      }
    } catch (error) {
      warnings.push(`${next}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    seedUrl: seed.toString(),
    visitedUrls: [...visited],
    contacts: [...contacts.values()],
    leadershipSignals: [...leadershipSignals.values()].slice(0, 50),
    propertySignals: [...propertySignals.values()].slice(0, 100),
    socialUrls: [...socialUrls],
    warnings,
  };
}

export function extractContacts(html: string, sourceUrl: string): WebsiteContact[] {
  const decoded = decodeBasicEntities(html);
  const plain = htmlToText(html);
  const contacts = new Map<string, WebsiteContact>();

  for (const match of plain.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    const email = match[0].toLowerCase().replace(/[),.;:]+$/, '');
    if (email.endsWith('@example.com') || /\.(png|jpg|jpeg|gif|webp)$/i.test(email)) continue;
    contacts.set(`email:${email}`, {
      type: 'email',
      value: email,
      sourceUrl,
      context: nearbyContext(plain, match.index ?? 0, match[0].length),
    });
  }

  for (const match of plain.matchAll(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]\d{4}(?:\s*(?:x|ext\.?)\s*\d{1,6})?/gi)) {
    const phone = normalizeUsPhone(match[0]);
    if (!phone) continue;
    contacts.set(`phone:${phone}`, {
      type: 'phone',
      value: phone,
      sourceUrl,
      context: nearbyContext(plain, match.index ?? 0, match[0].length),
    });
  }

  for (const match of decoded.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    const email = match[0].toLowerCase().replace(/[),.;:]+$/, '');
    if (email.endsWith('@example.com') || /\.(png|jpg|jpeg|gif|webp)$/i.test(email) || contacts.has(`email:${email}`)) continue;
    const context = htmlToText(decoded.slice(Math.max(0, (match.index ?? 0) - 240), (match.index ?? 0) + match[0].length + 240));
    contacts.set(`email:${email}`, { type: 'email', value: email, sourceUrl, context: context || undefined });
  }

  for (const match of decoded.matchAll(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]\d{4}(?:\s*(?:x|ext\.?)\s*\d{1,6})?/gi)) {
    const phone = normalizeUsPhone(match[0]);
    if (!phone || contacts.has(`phone:${phone}`)) continue;
    const context = htmlToText(decoded.slice(Math.max(0, (match.index ?? 0) - 240), (match.index ?? 0) + match[0].length + 240));
    contacts.set(`phone:${phone}`, { type: 'phone', value: phone, sourceUrl, context: context || undefined });
  }

  return [...contacts.values()];
}

export function extractLeadershipSignals(html: string, sourceUrl: string): WebsiteLeadershipSignal[] {
  const text = htmlToText(html);
  const lines = text.split(/\n+/).map((line) => line.trim()).filter((line) => line.length >= 5 && line.length <= 240);
  return lines.filter((line) => DECISION_TITLES.test(line)).slice(0, 50).map((line) => ({ text: line, sourceUrl }));
}

export function extractPropertySignals(html: string, sourceUrl: string): WebsitePropertySignal[] {
  const text = htmlToText(html);
  const statePattern = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
  const addressPattern = new RegExp('\\b\\d{1,6}\\s+[A-Za-z0-9][A-Za-z0-9 .\\\'-]{2,70}\\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Place|Pl|Parkway|Pkwy|Highway|Hwy|Way)\\b(?:[^\\n,]{0,40})?,?\\s+[A-Za-z .\\\'-]{2,40},?\\s+(' + statePattern + ')\\s+\\d{5}(?:-\\d{4})?\\b', 'gi');
  const output = new Map<string, WebsitePropertySignal>();
  for (const match of text.matchAll(addressPattern)) {
    const address = match[0].replace(/\\s+/g, ' ').trim().replace(/^[,;: -]+|[,;: -]+$/g, '');
    if (address.length < 12 || address.length > 180) continue;
    output.set(address.toLowerCase(), { address, state: match[1]?.toUpperCase(), sourceUrl });
  }
  return [...output.values()];
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
        headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'PumaUtilitiesResearch/1.0 (+public business research)' },
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
      const html = (await response.text()).slice(0, 2_000_000);
      return { html, finalUrl: current };
    }
    throw new Error('Too many redirects.');
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener('abort', abort);
  }
}

function prioritizedUrls(seed: URL): string[] {
  return DEFAULT_PATHS.map((path) => new URL(path, seed.origin).toString());
}

function extractLikelyInternalPages(html: string, seed: URL): string[] {
  const output = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const url = new URL(match[1], seed.origin);
      if (url.origin !== seed.origin || !isPublicHttpUrl(url.toString())) continue;
      if (/\b(about|team|leadership|management|people|staff|portfolio|properties|contact)\b/i.test(url.pathname)) {
        url.hash = '';
        output.add(url.toString());
      }
    } catch {
      // Ignore malformed links.
    }
  }
  return [...output];
}

function extractSocialUrls(html: string): string[] {
  const output = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) {
    try {
      const url = new URL(match[1]);
      if (/^(?:www\.)?(linkedin\.com|facebook\.com|instagram\.com|x\.com|twitter\.com)$/i.test(url.hostname)) output.add(url.toString());
    } catch {
      // Ignore malformed URLs.
    }
  }
  return [...output];
}

function nearbyContext(text: string, start: number, length: number): string | undefined {
  const context = text.slice(Math.max(0, start - 180), Math.min(text.length, start + length + 180)).replace(/\s+/g, ' ').trim();
  return context || undefined;
}

function normalizeUsPhone(value: string): string | undefined {
  const extension = value.match(/(?:x|ext\.?)\s*(\d{1,6})/i)?.[1];
  let digits = value.replace(/\D/g, '');
  if (extension && digits.endsWith(extension)) digits = digits.slice(0, -extension.length);
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return undefined;
  const formatted = `+1${digits}`;
  return extension ? `${formatted}x${extension}` : formatted;
}

function htmlToText(html: string): string {
  return decodeBasicEntities(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|p|div|li|h1|h2|h3|h4|section|article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
}
