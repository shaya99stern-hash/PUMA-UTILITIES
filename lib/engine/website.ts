/**
 * Company websites: find the domain, crawl the few pages that matter (home, contact, about,
 * team/leadership, portfolio) and extract emails, phones, people + titles, LinkedIn, office
 * address and portfolio claims ("4,000 apartments across 30 buildings").
 *
 * Domain discovery is keyless: domains seen in published emails, registry websites, optional
 * search APIs, then guesses built from the company name that must (a) resolve in DNS and
 * (b) serve a homepage that actually names the company.
 */
import { parse, type HTMLElement } from 'node-html-parser';
import { fetchSource, SourceError } from './http';
import { resolveDns } from './sources/dns';
import type { FetchCtx } from './sources/common';
import { cleanPhone, displayPersonName, isDecisionMakerTitle, looksLikePerson, nameTokens, normalizeDomain, normalizeEmail, roleCategoryFor } from './text';

export const WEBSITE_SOURCE = { id: 'company-website', name: 'Company website' };

export type SitePerson = { name: string; title: string | null; email: string | null; phone: string | null; linkedin: string | null };
export type SiteFacts = {
  url: string;
  siteName: string | null;
  title: string | null;
  emails: string[];
  phones: string[];
  people: SitePerson[];
  linkedin: string | null;
  addresses: string[];
  portfolio: { units?: number; buildings?: number }[];
  links: string[];
  realEstate: boolean;
  text: string;
};

const TITLE_WORDS = /\b(President|CEO|C\.E\.O\.|Chief [A-Z][a-z]+ Officer|Founder|Co-Founder|Principal|Managing (Partner|Director|Member)|Partner|Owner|Chairman|Chair|Vice President|VP|SVP|EVP|Director|Head of [A-Z][a-z]+|Property Manager|Regional Manager|Portfolio Manager|Asset Manager|Operations Manager|General Manager|Controller|COO|CFO|CTO|Superintendent|Facilities Manager|Manager)\b/;
const REAL_ESTATE = /\b(apartment|apartments|residential|multifamily|multi-family|property management|properties|real estate|realty|leasing|tenants?|residents?|rentals?|landlord|housing|units|buildings|communities)\b/i;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const OBFUSCATED_RE = /([A-Z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\sat\s)\s*([A-Z0-9-]+)\s*(?:\[dot\]|\(dot\)|\sdot\s|\.)\s*([A-Z]{2,})/gi;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/g;

function cleanText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function decodeEntities(value: string) {
  return value.replace(/&amp;/g, '&').replace(/&#64;|&commat;/g, '@').replace(/&#46;|&period;/g, '.').replace(/&nbsp;/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
}

/** Extracts structured facts from one HTML page. Pure; exported for tests. */
export function extractSite(html: string, pageUrl: string): SiteFacts {
  const root = parse(html, { comment: false, blockTextElements: { script: true, style: false, noscript: false } });
  const scripts = root.querySelectorAll('script[type="application/ld+json"]').map((s) => s.text);
  root.querySelectorAll('script,style,noscript,svg').forEach((el) => el.remove());
  const text = decodeEntities(cleanText(root.text));
  const base = new URL(pageUrl);

  const meta = (sel: string) => root.querySelector(sel)?.getAttribute('content')?.trim() || null;
  const title = cleanText(root.querySelector('title')?.text ?? '') || null;
  const siteName = meta('meta[property="og:site_name"]') ?? (title ? title.split(/\s[|–—-]\s/)[0].trim() : null);

  const emails = new Set<string>();
  const phones = new Map<string, number>();
  const links: string[] = [];
  let linkedin: string | null = null;

  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href')?.trim() ?? '';
    if (/^mailto:/i.test(href)) {
      const e = normalizeEmail(decodeURIComponent(href.replace(/^mailto:/i, '').split('?')[0]));
      if (e) emails.add(e);
    } else if (/^tel:/i.test(href)) {
      const p = cleanPhone(href.replace(/^tel:/i, ''));
      if (p) phones.set(p, (phones.get(p) ?? 0) + 3);
    } else if (/linkedin\.com\/company\//i.test(href) && !linkedin) {
      linkedin = href.split('?')[0];
    } else {
      try {
        const u = new URL(href, base);
        if ((u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.replace(/^www\./, '') === base.hostname.replace(/^www\./, '')) links.push(u.toString().split('#')[0]);
      } catch {
        // ignore bad hrefs
      }
    }
  }
  for (const m of text.matchAll(EMAIL_RE)) {
    const e = normalizeEmail(m[0]);
    if (e && !/\.(png|jpe?g|gif|svg|webp)$/i.test(e) && !/^(example|email|name|your)@/.test(e) && !/sentry|wixpress|example\.com|domain\.com/.test(e)) emails.add(e);
  }
  for (const m of text.matchAll(OBFUSCATED_RE)) {
    const e = normalizeEmail(`${m[1]}@${m[2]}.${m[3]}`);
    if (e) emails.add(e);
  }
  for (const m of text.matchAll(PHONE_RE)) {
    const p = cleanPhone(`${m[1]}${m[2]}${m[3]}`);
    if (p) phones.set(p, (phones.get(p) ?? 0) + 1);
  }

  const people = new Map<string, SitePerson>();
  const addPerson = (name: string, title: string | null, extra: Partial<SitePerson> = {}) => {
    const clean = cleanText(name).replace(/,.*$/, '');
    if (!looksLikePerson(clean)) return;
    const display = displayPersonName(null, null, clean);
    const key = display.toLowerCase();
    const existing = people.get(key);
    if (existing) {
      existing.title ??= title;
      existing.email ??= extra.email ?? null;
      existing.phone ??= extra.phone ?? null;
      existing.linkedin ??= extra.linkedin ?? null;
    } else people.set(key, { name: display, title, email: extra.email ?? null, phone: extra.phone ?? null, linkedin: extra.linkedin ?? null });
  };

  // JSON-LD Person / Organization.
  const addresses: string[] = [];
  for (const raw of scripts) {
    try {
      const data = JSON.parse(raw) as unknown;
      const nodes: unknown[] = Array.isArray(data) ? data : [(data as { '@graph'?: unknown[] })['@graph'] ?? data].flat();
      for (const node of nodes as Record<string, unknown>[]) {
        const type = String(node?.['@type'] ?? '');
        if (/Person/i.test(type) && typeof node.name === 'string') {
          addPerson(node.name, typeof node.jobTitle === 'string' ? node.jobTitle : null, { email: normalizeEmail(String(node.email ?? '').replace(/^mailto:/, '')) });
        }
        const addr = node?.address as Record<string, string> | undefined;
        if (addr && typeof addr === 'object' && addr.streetAddress) {
          addresses.push(cleanText(`${addr.streetAddress}, ${addr.addressLocality ?? ''} ${addr.addressRegion ?? ''} ${addr.postalCode ?? ''}`));
        }
        if (typeof node?.telephone === 'string') {
          const p = cleanPhone(node.telephone);
          if (p) phones.set(p, (phones.get(p) ?? 0) + 3);
        }
        if (typeof node?.email === 'string') {
          const e = normalizeEmail(node.email.replace(/^mailto:/, ''));
          if (e) emails.add(e);
        }
      }
    } catch {
      // ignore invalid JSON-LD
    }
  }

  // Team cards: a short "name" element followed closely by a title element.
  const blocks = root.querySelectorAll('h1,h2,h3,h4,h5,h6,strong,b,p,span,div,li,figcaption,td');
  for (let i = 0; i < blocks.length; i += 1) {
    const el = blocks[i];
    if (el.childNodes.length > 3) continue;
    const t = cleanText(el.text);
    if (t.length < 5 || t.length > 40 || !looksLikePerson(t)) continue;
    for (let j = i + 1; j < Math.min(blocks.length, i + 5); j += 1) {
      const next = cleanText(blocks[j].text);
      if (!next || next === t) continue;
      if (next.length <= 80 && TITLE_WORDS.test(next)) {
        addPerson(t, next.replace(/\s*[|•].*$/, ''), cardContact(el));
        break;
      }
      if (next.length > 80) break;
    }
  }
  // Inline "Jane Doe, President" / "Jane Doe – Principal" patterns.
  for (const m of text.matchAll(/([A-Z][a-z'’.-]+(?:\s[A-Z][a-z'’.-]+){1,2})\s*(?:,|–|—|-|\|)\s*((?:Co-)?Founder|President|CEO|Principal|Managing (?:Partner|Director|Member)|Owner|Chairman|Vice President[^,.;]{0,30}|Director of [A-Z][a-z]+(?: [A-Z][a-z]+)?|Property Manager|Regional Manager|COO|CFO)\b/g)) {
    addPerson(m[1], m[2]);
  }

  // Portfolio claims.
  const portfolio: { units?: number; buildings?: number }[] = [];
  for (const m of text.matchAll(/(?:over|more than|approximately|nearly|~)?\s*(\d{1,3}(?:,\d{3})+|\d{2,6})\s*\+?\s*(apartment units|apartments|units|residential units|homes|residences|doors)\b/gi)) {
    const n = Number(m[1].replace(/,/g, ''));
    if (n >= 20 && n < 500_000) portfolio.push({ units: n });
  }
  for (const m of text.matchAll(/(?:over|more than|approximately|nearly)?\s*(\d{1,3}(?:,\d{3})*|\d{1,5})\s*\+?\s*(buildings|properties|communities|apartment communities)\b/gi)) {
    const n = Number(m[1].replace(/,/g, ''));
    if (n >= 2 && n < 20_000) portfolio.push({ buildings: n });
  }
  // Street addresses in text ("123 Main Street, Suite 4, Newark, NJ 07102").
  for (const m of text.matchAll(/\b(\d{1,6}\s+[A-Z0-9][A-Za-z0-9.\s]{2,40}?\b(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Place|Pl|Drive|Dr|Lane|Ln|Plaza|Parkway|Pkwy|Turnpike|Tpke|Highway|Hwy|Court|Ct|Way|Square|Sq)\.?(?:,?\s*(?:Suite|Ste|Floor|Fl|#)\s*[A-Za-z0-9-]+)?,?\s+[A-Z][A-Za-z.\s]{2,25},?\s+[A-Z]{2}\s+\d{5})\b/g)) {
    addresses.push(cleanText(m[1]));
  }

  const phoneList = [...phones.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  return {
    url: pageUrl,
    siteName: siteName && siteName.length < 80 ? siteName : null,
    title,
    emails: [...emails],
    phones: phoneList.slice(0, 6),
    people: [...people.values()].slice(0, 40),
    linkedin,
    addresses: [...new Set(addresses)].slice(0, 6),
    portfolio,
    links: [...new Set(links)],
    realEstate: REAL_ESTATE.test(text),
    text: text.slice(0, 20_000),
  };
}

function cardContact(el: HTMLElement): Partial<SitePerson> {
  const card = el.parentNode?.parentNode as HTMLElement | null;
  if (!card) return {};
  const out: Partial<SitePerson> = {};
  for (const a of card.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    if (/^mailto:/i.test(href)) out.email = normalizeEmail(href.replace(/^mailto:/i, '').split('?')[0]);
    else if (/^tel:/i.test(href)) out.phone = cleanPhone(href.replace(/^tel:/i, ''));
    else if (/linkedin\.com\/in\//i.test(href)) out.linkedin = href.split('?')[0];
  }
  return out;
}

const INTERESTING = /(contact|about|team|leadership|management|people|staff|our-company|who-we-are|executive|principals|portfolio|properties|communities|locations|residential)/i;

/** Chooses which internal links to crawl after the homepage (most informative first). */
export function pickLinks(links: string[], max = 5): string[] {
  const scored = links
    .filter((l) => INTERESTING.test(new URL(l).pathname) && !/\.(pdf|jpe?g|png|gif|zip|docx?)$/i.test(l) && !/(blog|news|careers|jobs|login|apply|pay|portal|privacy|terms)/i.test(l))
    .map((l) => {
      const p = new URL(l).pathname.toLowerCase();
      let s = 0;
      if (/team|leadership|people|staff|executive|principals|management-team|our-team/.test(p)) s += 5;
      if (/contact/.test(p)) s += 4;
      if (/about|who-we-are|our-company/.test(p)) s += 3;
      if (/portfolio|properties|communities/.test(p)) s += 2;
      s -= p.split('/').length * 0.2;
      return { l, s };
    })
    .sort((a, b) => b.s - a.s);
  return [...new Set(scored.map((x) => x.l))].slice(0, max);
}

/** Does this page plausibly belong to the named company? */
export function siteMatchesName(facts: Pick<SiteFacts, 'siteName' | 'title' | 'text'>, name: string): number {
  const tokens = nameTokens(name).filter((t) => !/^(management|realty|properties|property|group|company|companies|associates|residential|apartments|partners|holdings|services|development|corp)$/.test(t));
  if (!tokens.length) return 0;
  const hay = `${facts.siteName ?? ''} ${facts.title ?? ''} ${facts.text.slice(0, 6000)}`.toLowerCase();
  const hits = tokens.filter((t) => hay.includes(t)).length;
  const head = `${facts.siteName ?? ''} ${facts.title ?? ''}`.toLowerCase();
  const headHits = tokens.filter((t) => head.includes(t)).length;
  return hits / tokens.length * 0.6 + (headHits / tokens.length) * 0.4;
}

/** Candidate domains from a company name ("Glenwood Management Corp" -> glenwoodmanagement.com, glenwood.com, ...). */
export function domainGuesses(name: string): string[] {
  const words = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !/^(llc|inc|corp|corporation|co|lp|llp|ltd|the|of|l|p|c)$/.test(w));
  if (!words.length) return [];
  const core = words.filter((w) => !/^(management|mgmt|realty|properties|property|group|company|companies|associates|residential|apartments|partners|holdings|services|development|enterprises|and)$/.test(w));
  const base = (core.length ? core : words).slice(0, 3);
  const joined = base.join('');
  const full = words.slice(0, 4).join('');
  const out = new Set<string>();
  const add = (s: string) => {
    if (s.length >= 4 && s.length <= 40) out.add(s);
  };
  add(`${full}.com`);
  add(`${joined}.com`);
  if (words.length > 1) add(`${words.slice(0, 4).join('-')}.com`);
  for (const suffix of ['management', 'mgmt', 'properties', 'realty', 'residential', 'apartments', 'group', 'co', 'nyc', 'nj']) add(`${joined}${suffix}.com`);
  add(`${joined}.net`);
  return [...out].slice(0, 12);
}

export type CrawlResult = { domain: string; homepage: string; pages: SiteFacts[]; matchScore: number };

async function fetchPage(url: string, ctx: FetchCtx) {
  const res = await fetchSource({ sourceId: WEBSITE_SOURCE.id, url, web: true, deadline: ctx.deadline, timeoutMs: 9000, retries: 0, ttlMs: 7 * 24 * 3_600_000 });
  if (res.contentType && !/html|xml|text/i.test(res.contentType)) throw new SourceError(WEBSITE_SOURCE.id, 'parse', 'Not an HTML page');
  return extractSite(res.body, res.url);
}

/** Fetches the homepage of a domain and checks it names the company. */
export async function probeDomain(domain: string, name: string, ctx: FetchCtx): Promise<{ facts: SiteFacts; score: number } | null> {
  for (const url of [`https://${domain}/`, `https://www.${domain}/`]) {
    try {
      const facts = await fetchPage(url, ctx);
      const score = siteMatchesName(facts, name) + (facts.realEstate ? 0.15 : -0.3);
      return { facts, score };
    } catch (error) {
      if (error instanceof SourceError && (error.code === 'budget' || error.code === 'robots')) return null;
    }
  }
  return null;
}

/** Tries name-based domain guesses; returns the first that resolves and names the company. */
export async function guessDomain(name: string, ctx: FetchCtx, tried: Set<string>): Promise<{ domain: string; facts: SiteFacts; score: number } | null> {
  for (const guess of domainGuesses(name)) {
    if (tried.has(guess)) continue;
    tried.add(guess);
    if (ctx.deadline && Date.now() > ctx.deadline - 4000) return null;
    let resolves = false;
    try {
      resolves = (await resolveDns(guess, 'A', ctx)).length > 0;
    } catch {
      resolves = false;
    }
    if (!resolves) continue;
    const probe = await probeDomain(guess, name, ctx);
    if (probe && probe.score >= 0.75) return { domain: guess, ...probe };
  }
  return null;
}

/** Crawls a verified domain: homepage + the most informative internal pages. */
export async function crawlSite(domain: string, ctx: FetchCtx, maxPages = 5, homepage?: SiteFacts): Promise<CrawlResult> {
  const pages: SiteFacts[] = [];
  let home = homepage ?? null;
  if (!home) {
    for (const url of [`https://${domain}/`, `https://www.${domain}/`]) {
      try {
        home = await fetchPage(url, ctx);
        break;
      } catch {
        // try www
      }
    }
  }
  if (!home) return { domain, homepage: `https://${domain}/`, pages, matchScore: 0 };
  pages.push(home);
  for (const link of pickLinks(home.links, maxPages)) {
    if (ctx.deadline && Date.now() > ctx.deadline - 3000) break;
    try {
      pages.push(await fetchPage(link, ctx));
    } catch {
      // skip pages that fail
    }
  }
  return { domain, homepage: home.url, pages, matchScore: 0 };
}

export function domainOfUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return normalizeDomain(url);
  }
}

export function personFromSite(p: SitePerson) {
  return {
    name: p.name,
    title: p.title,
    role: roleCategoryFor(p.title),
    decisionMaker: isDecisionMakerTitle(p.title),
    email: p.email,
    phone: p.phone,
    linkedin: p.linkedin,
  };
}
