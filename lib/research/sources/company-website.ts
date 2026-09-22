import { assertPublicNetworkTarget } from '../network-safety';
import { isPublicHttpUrl } from '../web-search';

const DEFAULT_PATHS = ['/', '/about', '/about-us', '/team', '/leadership', '/management', '/properties', '/portfolio', '/contact', '/contact-us'];
const DECISION_TITLES = /\b(owner|founder|principal|managing principal|managing partner|president|chief executive officer|ceo|chief operating officer|coo|chief property officer|head of property management|property manager|regional property manager|asset manager|director of asset management|director of operations|facilities director|director of facilities|vice president(?: of operations| of property management| of asset management)?)\b/i;

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
  units?: number;
  grossSquareFeet?: number;
  sourceUrl: string;
}

export interface WebsitePortfolioSignal {
  count: number;
  label: 'buildings' | 'properties' | 'communities' | 'locations';
  qualifier: 'exact' | 'at-least';
  text: string;
  sourceUrl: string;
}

export interface WebsiteOwnerOperatorSignal {
  text: string;
  sourceUrl: string;
}

export interface CompanyWebsiteResearch {
  seedUrl: string;
  visitedUrls: string[];
  contacts: WebsiteContact[];
  leadershipSignals: WebsiteLeadershipSignal[];
  propertySignals?: WebsitePropertySignal[];
  portfolioSignals?: WebsitePortfolioSignal[];
  ownerOperatorSignals?: WebsiteOwnerOperatorSignal[];
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
  try {
    const sitemapXml = await fetchSitemap(seed.origin, timeoutMs, options.signal);
    const sitemapUrls = extractLikelySitemapUrls(sitemapXml, seed.origin).slice(0, maxPages * 2);
    queue.splice(1, 0, ...sitemapUrls.filter((url) => !queue.includes(url)));
  } catch {
    // Sitemaps are optional; continue with bounded page discovery.
  }
  const visited = new Set<string>();
  const contacts = new Map<string, WebsiteContact>();
  const leadershipSignals = new Map<string, WebsiteLeadershipSignal>();
  const socialUrls = new Set<string>();
  const propertySignals = new Map<string, WebsitePropertySignal>();
  const portfolioSignals = new Map<string, WebsitePortfolioSignal>();
  const ownerOperatorSignals = new Map<string, WebsiteOwnerOperatorSignal>();
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
      for (const signal of extractPortfolioSignals(html, finalUrl)) portfolioSignals.set(signal.sourceUrl + ':' + signal.text, signal);
      for (const signal of extractOwnerOperatorSignals(html, finalUrl)) ownerOperatorSignals.set(signal.sourceUrl + ':' + signal.text, signal);
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
    portfolioSignals: [...portfolioSignals.values()].slice(0, 30),
    ownerOperatorSignals: [...ownerOperatorSignals.values()].slice(0, 20),
    socialUrls: [...socialUrls],
    warnings,
  };
}

export function extractContacts(html: string, sourceUrl: string): WebsiteContact[] {
  const decoded = decodeBasicEntities(html);
  const plain = htmlToText(html);
  const contacts = new Map<string, WebsiteContact>();

  for (const person of extractJsonLdPeople(html)) {
    const context = [person.name, person.jobTitle].filter(Boolean).join(' — ') || undefined;
    if (person.email) {
      const email = person.email.toLowerCase().replace(/^mailto:/i, '').trim();
      if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email) && !email.endsWith('@example.com')) {
        contacts.set(`email:${email}`, { type:'email', value:email, sourceUrl, context });
      }
    }
    if (person.telephone) {
      const phone = normalizeUsPhone(person.telephone.replace(/^tel:/i, ''));
      if (phone) contacts.set(`phone:${phone}`, { type:'phone', value:phone, sourceUrl, context });
    }
  }

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
  const signals = new Map<string, WebsiteLeadershipSignal>();
  for (const line of lines.filter((line) => DECISION_TITLES.test(line)).slice(0, 50)) {
    signals.set(line.toLowerCase(), { text: line, sourceUrl });
  }
  for (const person of extractJsonLdPeople(html)) {
    if (!person.name || !person.jobTitle || !DECISION_TITLES.test(person.jobTitle)) continue;
    const value = `${person.name} — ${person.jobTitle}`;
    signals.set(value.toLowerCase(), { text:value, sourceUrl });
  }
  return [...signals.values()].slice(0, 50);
}

export function extractPropertySignals(html: string, sourceUrl: string): WebsitePropertySignal[] {
  const text = htmlToText(html);
  const statePattern = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
  const addressPattern = new RegExp('\\b\\d{1,6}\\s+[A-Za-z0-9][A-Za-z0-9 .\\\'-]{2,70}\\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Place|Pl|Parkway|Pkwy|Highway|Hwy|Way)\\b(?:[^\\n,]{0,40})?,?\\s+[A-Za-z .\\\'-]{2,40},?\\s+(' + statePattern + ')\\s+\\d{5}(?:-\\d{4})?\\b', 'gi');
  const output = new Map<string, WebsitePropertySignal>();
  for (const match of text.matchAll(addressPattern)) {
    const address = match[0].replace(/\s+/g, ' ').trim().replace(/^[,;: -]+|[,;: -]+$/g, '');
    if (address.length < 12 || address.length > 180) continue;
    const context = nearbyContext(text, match.index ?? 0, match[0].length) ?? '';
    const unitsMatch = context.match(/\b(\d{1,4})\s*(?:[- ]?units?|apartments?)\b/i);
    const squareFeetMatch = context.match(/\b([\d,]{4,})\s*(?:square\s+feet|sq\.?\s*ft\.?|sf)\b/i);
    const units = unitsMatch ? Number(unitsMatch[1]) : undefined;
    const grossSquareFeet = squareFeetMatch ? Number(squareFeetMatch[1].replace(/,/g, '')) : undefined;
    output.set(address.toLowerCase(), {
      address,
      state: match[1]?.toUpperCase(),
      units: units && units <= 5000 ? units : undefined,
      grossSquareFeet: grossSquareFeet && grossSquareFeet <= 20_000_000 ? grossSquareFeet : undefined,
      sourceUrl,
    });
  }
  for (const item of extractJsonLdObjects(html)) {
    if (!isPropertySchemaObject(item)) continue;
    const address = schemaPostalAddress(item.address);
    if (!address) continue;
    const key = address.toLowerCase();
    const existing = output.get(key);
    const units = schemaUnits(item);
    const grossSquareFeet = schemaFloorSquareFeet(item.floorSize);
    output.set(key, {
      address,
      state: schemaRegion(item.address) ?? existing?.state,
      units: units ?? existing?.units,
      grossSquareFeet: grossSquareFeet ?? existing?.grossSquareFeet,
      sourceUrl,
    });
  }
  return [...output.values()];
}

export function extractPortfolioSignals(html: string, sourceUrl: string): WebsitePortfolioSignal[] {
  const text = htmlToText(html);
  const output: WebsitePortfolioSignal[] = [];
  const patterns = [
    /\b(?:(more than|over|at least)\s+)?(?:portfolio(?:\s+of|\s+includes|\s+consists of)?|owns?|manages?|operates?)\s+(\d{1,4})(\+)?\s+(buildings?|properties|communities|locations)\b/gi,
    /\b(?:owns?|own)\s+and\s+(?:manages?|operates?)\s+(?:(more than|over|at least)\s+)?(\d{1,4})(\+)?\s+(buildings?|properties|communities|locations)\b/gi,
    /\b(?:(more than|over|at least)\s+)?(\d{1,4})(\+)?[-\s]+(building|property|community|location)\s+portfolio\b/gi,
  ];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const count = Number(match[2]);
      if (!Number.isFinite(count) || count < 2 || count > 5000) continue;
      const rawLabel = match[4].toLowerCase();
      const label = rawLabel.startsWith('building') ? 'buildings'
        : rawLabel.startsWith('propert') ? 'properties'
          : rawLabel.startsWith('communit') ? 'communities'
            : 'locations';
      const qualifier = match[1] || match[3] ? 'at-least' : 'exact';
      const signal: WebsitePortfolioSignal = { count, label, qualifier, text: match[0].replace(/\s+/g, ' ').trim(), sourceUrl };
      const key = qualifier + ':' + count + ':' + label;
      if (!seen.has(key)) {
        seen.add(key);
        output.push(signal);
      }
    }
  }
  return output.slice(0, 30);
}

export function extractOwnerOperatorSignals(html: string, sourceUrl: string): WebsiteOwnerOperatorSignal[] {
  const text = htmlToText(html);
  const lines = text.split(/\n+/).map((line) => line.replace(/\s+/g, ' ').trim()).filter((line) => line.length >= 12 && line.length <= 320);
  return lines
    .filter((line) => /\b(owner[- ]?operator|owns? and (?:self[- ]?)?manages?|acquires?,? owns?,? and manages?|vertically integrated owner|owner and manager)\b/i.test(line))
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

type JsonLdPerson = { name?: string; jobTitle?: string; email?: string; telephone?: string };

function extractJsonLdPeople(html: string): JsonLdPerson[] {
  return extractJsonLdObjects(html)
    .filter((item) => schemaTypes(item).some((type) => type.toLowerCase() === 'person'))
    .map((item) => ({
      name: schemaString(item.name),
      jobTitle: schemaString(item.jobTitle),
      email: schemaString(item.email),
      telephone: schemaString(item.telephone),
    }))
    .filter((person) => Boolean(person.name));
}

function extractJsonLdObjects(html: string): Record<string, unknown>[] {
  const output: Record<string, unknown>[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      flattenJsonLd(JSON.parse(decodeBasicEntities(match[1])), output);
    } catch {
      // Ignore malformed schema blocks.
    }
  }
  return output;
}

function flattenJsonLd(value: unknown, output: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => flattenJsonLd(item, output));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  output.push(record);
  if (Array.isArray(record['@graph'])) record['@graph'].forEach((item) => flattenJsonLd(item, output));
}

function schemaTypes(item: Record<string, unknown>): string[] {
  const value = item['@type'];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : typeof value === 'string' ? [value] : [];
}

function isPropertySchemaObject(item: Record<string, unknown>): boolean {
  const types = schemaTypes(item).map((type) => type.toLowerCase());
  const propertyType = types.some((type) => ['apartmentcomplex','apartment','residence','singlefamilyresidence','place','realestatelisting'].includes(type));
  return propertyType && Boolean(item.address);
}

function schemaPostalAddress(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  const parts = [
    schemaString(item.streetAddress),
    schemaString(item.addressLocality),
    schemaString(item.addressRegion),
    schemaString(item.postalCode),
  ].filter((part): part is string => Boolean(part));
  if (parts.length < 3) return undefined;
  const street = parts[0];
  const city = parts[1];
  const region = parts[2];
  const postal = parts[3];
  return [street, city, [region, postal].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

function schemaRegion(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return schemaString((value as Record<string, unknown>).addressRegion)?.toUpperCase();
}

function schemaUnits(item: Record<string, unknown>): number | undefined {
  const value = item.numberOfAccommodationUnits ?? item.numberOfUnits;
  const parsed = schemaNumber(value);
  return parsed && parsed > 0 && parsed <= 20_000 ? parsed : undefined;
}

function schemaFloorSquareFeet(value: unknown): number | undefined {
  if (typeof value === 'number') return value > 0 && value <= 100_000_000 ? value : undefined;
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  const amount = schemaNumber(item.value);
  const unit = schemaString(item.unitText) ?? schemaString(item.unitCode);
  if (!amount || amount <= 0 || amount > 100_000_000) return undefined;
  if (unit && !/(sq\.?\s*ft|square\s*feet|ft2|ft²)/i.test(unit)) return undefined;
  return amount;
}

function schemaString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function schemaNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/,/g, '')) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
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


export function extractLikelySitemapUrls(xml: string, origin: string): string[] {
  const normalizedOrigin = new URL(origin).origin;
  const output = new Set<string>();
  for (const match of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    try {
      const url = new URL(decodeBasicEntities(match[1]));
      if (url.origin !== normalizedOrigin || !isPublicHttpUrl(url.toString())) continue;
      if (!/\b(about|team|leadership|management|people|staff|portfolio|properties|buildings|communities|contact)\b/i.test(url.pathname)) continue;
      url.hash = '';
      output.add(url.toString());
    } catch {
      // Ignore malformed sitemap entries.
    }
  }
  return [...output];
}

async function fetchSitemap(origin: string, timeoutMs: number, outerSignal?: AbortSignal): Promise<string> {
  const start = new URL('/sitemap.xml', origin);
  const allowedHost = start.hostname.toLowerCase().replace(/^www\./, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  outerSignal?.addEventListener('abort', abort, { once:true });
  try {
    let current = start.toString();
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      if (!isPublicHttpUrl(current)) throw new Error('Refused non-public sitemap URL.');
      const currentUrl = new URL(current);
      if (currentUrl.hostname.toLowerCase().replace(/^www\./, '') !== allowedHost) throw new Error('Refused cross-host sitemap redirect.');
      await assertPublicNetworkTarget(current);
      const response = await fetch(current, {
        headers:{ Accept:'application/xml,text/xml;q=0.9,text/plain;q=0.8', 'User-Agent':'PumaUtilitiesResearch/1.3 public business research' },
        redirect:'manual',
        cache:'no-store',
        signal:controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error(`Sitemap redirect ${response.status} had no location.`);
        current = new URL(location, current).toString();
        continue;
      }
      if (!response.ok) throw new Error(`Sitemap HTTP ${response.status}`);
      const length = Number(response.headers.get('content-length') ?? 0);
      if (length > 1_000_000) throw new Error('Sitemap is too large.');
      return (await response.text()).slice(0, 1_000_000);
    }
    throw new Error('Too many sitemap redirects.');
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener('abort', abort);
  }
}
