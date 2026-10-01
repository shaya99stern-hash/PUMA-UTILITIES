/**
 * ContactOut public company pages (contactout.com/company/<Name>-<id>), which robots.txt allows.
 * Without signing in they show the staff directory (names + exact titles), the company email
 * format with its adoption rate, the office phone/address, website and LinkedIn, and sometimes a
 * published executive email. Masked addresses ("******@domain") are ignored. We never sign in,
 * reveal masked data or spend account credits automatically.
 */
import { fetchSource } from '../http';
import { search, searchProvider } from './web-search';
import { cleanPhone, looksLikePerson, nameTokens, normalizeDomain, normalizeEmail } from '../text';
import type { Pattern } from '../emails';
import type { SourceInfo } from '../types';
import type { FetchCtx } from './common';

export const contactOut: SourceInfo = {
  id: 'contactout',
  name: 'ContactOut (public company pages)',
  kind: 'enrichment',
  coverage: ['WEB'],
  coverageLabel: 'Companies with a ContactOut profile',
  capabilities: ['staff_directory', 'exact_titles', 'email_format', 'company_phone', 'office_address', 'website', 'linkedin'],
  description: 'Public company profiles: employee names and titles, the company email format, office phone and address. Found via a search API key or a ContactOut link saved on the company.',
  homepage: 'https://contactout.com',
  verified: 'live',
};

export type ContactOutCompany = {
  url: string;
  name: string | null;
  phone: string | null;
  location: string | null;
  website: string | null;
  linkedin: string | null;
  employeeCount: number | null;
  employees: { name: string; title: string | null; profileUrl: string | null }[];
  emailFormat: { pattern: Pattern; domain: string; pct: number | null; raw: string } | null;
  publishedEmails: { email: string; person: string | null }[];
};

const FORMAT_TOKENS: Record<string, Pattern> = {
  '{first}.{last}': 'first.last',
  '{first}{last}': 'firstlast',
  '{first_initial}{last}': 'flast',
  '{first_initial}.{last}': 'f.last',
  '{first}': 'first',
  '{first}{last_initial}': 'firstl',
  '{first}_{last}': 'first_last',
  '{last}.{first}': 'last.first',
  '{last}{first_initial}': 'lastf',
  '{last}': 'last',
};

export function isContactOutCompanyUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?contactout\.com\/company\/[A-Za-z0-9%.-]+-\d+\/?$/i.test(url.split('?')[0]);
}

function decode(s: string) {
  return s.replace(/&amp;/g, '&').replace(/&#039;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\\u0026/g, '&');
}

/** Parses a public ContactOut company page. Pure; exported for tests. */
export function parseContactOutCompany(html: string, url: string): ContactOutCompany {
  const out: ContactOutCompany = { url, name: null, phone: null, location: null, website: null, linkedin: null, employeeCount: null, employees: [], emailFormat: null, publishedEmails: [] };
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(m[1]) as { '@type'?: string; mainEntity?: Record<string, unknown> };
      const org = data['@type'] === 'ProfilePage' ? data.mainEntity : null;
      if (!org || org['@type'] !== 'Organization') continue;
      out.name = typeof org.name === 'string' ? org.name : null;
      const cp = org.contactPoint as { telephone?: string } | undefined;
      out.phone = cleanPhone(cp?.telephone ?? null);
      out.location = typeof org.location === 'string' ? org.location : null;
      for (const s of (org.sameAs as string[] | undefined) ?? []) {
        if (/linkedin\.com\/company/i.test(s)) out.linkedin ??= s;
        else if (!/contactout\.com|facebook|twitter|instagram|x\.com/i.test(s)) out.website ??= s;
      }
      for (const e of (org.employee as { name?: string; jobTitle?: string; url?: string }[] | undefined) ?? []) {
        if (e.name && looksLikePerson(e.name)) out.employees.push({ name: e.name, title: e.jobTitle ?? null, profileUrl: e.url ?? null });
      }
    } catch {
      // ignore malformed blocks
    }
  }
  const text = decode(html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  const fmt = text.match(/email format is (\{[a-z_{}.]+\})(?:@([a-z0-9.-]+\.[a-z]{2,}))?[^.]*?(?:\(e\.g\.\s*[a-z0-9._-]+@([a-z0-9.-]+\.[a-z]{2,})\))?[^.]*?(\d{1,3})%/i);
  if (fmt) {
    const pattern = FORMAT_TOKENS[fmt[1].toLowerCase()];
    const domain = normalizeDomain(fmt[2] ?? fmt[3] ?? '');
    if (pattern && domain) out.emailFormat = { pattern, domain, pct: Number(fmt[4]) || null, raw: fmt[1] };
  }
  const count = text.match(/with (\d[\d,]*) employees/i);
  if (count) out.employeeCount = Number(count[1].replace(/,/g, ''));
  // Executive emails stated in plain text, e.g. "To contact Steven Denholtz email at sjd@denholtznj.com".
  for (const m of text.matchAll(/To contact ([A-Z][A-Za-z'’.-]+(?: [A-Z][A-Za-z'’.-]+){1,2}) email at ([^?]+?)\.(?:\s|$)/g)) {
    for (const raw of m[2].split(/\s+or\s+|,\s*/)) {
      const email = normalizeEmail(raw.trim());
      if (email && !email.includes('*')) out.publishedEmails.push({ email, person: m[1] });
    }
  }
  return out;
}

export async function fetchContactOutCompany(url: string, ctx: FetchCtx): Promise<ContactOutCompany> {
  const res = await fetchSource({ sourceId: contactOut.id, url: url.split('?')[0], web: true, deadline: ctx.deadline, timeoutMs: 12_000, retries: 1, ttlMs: 14 * 24 * 3_600_000 });
  return parseContactOutCompany(res.body, res.url);
}

/** Finds a company's ContactOut page through the configured search API (if any). */
export async function findContactOutUrl(name: string, ctx: FetchCtx): Promise<string | null> {
  if (!searchProvider()) return null;
  const hits = await search(`site:contactout.com/company "${name}"`, ctx, 6);
  const tokens = nameTokens(name);
  for (const h of hits) {
    if (!isContactOutCompanyUrl(h.url)) continue;
    const slug = decodeURIComponent(h.url.split('/company/')[1] ?? '').toLowerCase();
    if (tokens.length && tokens.filter((t) => slug.includes(t)).length / tokens.length >= 0.6) return h.url.split('?')[0];
  }
  return null;
}

/** Deep link a user can open to spend one of their own ContactOut searches on a person. */
export function contactOutLookupUrl(person: string, company: string | null): string {
  const q = `site:contactout.com "${person}"${company ? ` "${company}"` : ''}`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}
