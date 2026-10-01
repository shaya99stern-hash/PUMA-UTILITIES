/**
 * Entity registries used to confirm legal names, websites and headquarters:
 * GLEIF (LEI records), Wikidata (large operators: official website, HQ) and SEC EDGAR (REITs / public companies).
 */
import { fetchJson } from '../http';
import { companyNameKey, looseNameKey, normalizeDomain, titleCase } from '../text';
import type { SourceInfo } from '../types';
import type { FetchCtx } from './common';

export const gleif: SourceInfo = {
  id: 'gleif',
  name: 'GLEIF Legal Entity Identifiers',
  kind: 'enrichment',
  coverage: ['US'],
  coverageLabel: 'Global',
  capabilities: ['legal_entity', 'headquarters_address', 'entity_status'],
  description: 'Global LEI registry: legal name, headquarters and legal address for institutional owners and lenders.',
  homepage: 'https://www.gleif.org/en/lei-data/gleif-api',
  verified: 'live',
};

export const wikidata: SourceInfo = {
  id: 'wikidata',
  name: 'Wikidata',
  kind: 'enrichment',
  coverage: ['US'],
  coverageLabel: 'Large operators',
  capabilities: ['official_website', 'headquarters'],
  description: 'Open knowledge graph: official websites and headquarters for large owners, REITs and managers.',
  homepage: 'https://www.wikidata.org/',
  verified: 'live',
};

export const secEdgar: SourceInfo = {
  id: 'sec-edgar',
  name: 'SEC EDGAR',
  kind: 'enrichment',
  coverage: ['US'],
  coverageLabel: 'Public companies / REITs',
  capabilities: ['public_company', 'reit_flag', 'website', 'business_address', 'phone'],
  description: 'Company tickers and submissions: identifies REITs (SIC 6798) and public owners with their business address and phone.',
  homepage: 'https://www.sec.gov/edgar/sec-api-documentation',
  // SEC requires a User-Agent with contact details; the probe host could not send one.
  verified: 'unverified',
};

export type RegistryMatch = { source: string; name: string; url: string; website?: string | null; address?: string | null; phone?: string | null; id?: string; isReit?: boolean; note?: string };

function sameEntity(a: string, b: string) {
  const ka = companyNameKey(a);
  const kb = companyNameKey(b);
  return ka === kb || looseNameKey(a) === looseNameKey(b) || (ka.length > 6 && (ka.startsWith(kb) || kb.startsWith(ka)));
}

type GleifResponse = { data?: { id: string; attributes: { entity: { legalName: { name: string }; status?: string; headquartersAddress?: { addressLines?: string[]; city?: string; region?: string; postalCode?: string }; jurisdiction?: string } } }[] };

export function parseGleif(data: GleifResponse, query: string, url: string): RegistryMatch | null {
  for (const rec of data.data ?? []) {
    const e = rec.attributes.entity;
    if (!sameEntity(e.legalName.name, query)) continue;
    const hq = e.headquartersAddress;
    const address = hq ? `${(hq.addressLines ?? []).join(' ')}, ${hq.city ?? ''} ${(hq.region ?? '').replace(/^US-/, '')} ${hq.postalCode ?? ''}`.replace(/\s+/g, ' ').trim() : null;
    return { source: gleif.id, name: e.legalName.name, url, address, id: rec.id, note: `LEI ${rec.id} (${e.status ?? 'unknown'}, ${e.jurisdiction ?? ''})` };
  }
  return null;
}

export async function lookupGleif(name: string, ctx: FetchCtx): Promise<RegistryMatch | null> {
  const url = `https://api.gleif.org/api/v1/lei-records?filter[fulltext]=${encodeURIComponent(name)}&page[size]=5`;
  const { data } = await fetchJson<GleifResponse>({ sourceId: gleif.id, url, deadline: ctx.deadline, timeoutMs: 10_000, retries: 1, ttlMs: 30 * 24 * 3_600_000, headers: { Accept: 'application/vnd.api+json' } });
  return parseGleif(data, name, url);
}

type WdSearch = { search?: { id: string; label?: string; description?: string; aliases?: string[]; match?: { text?: string } }[] };
type WdSparql = { results?: { bindings?: Record<string, { value: string }>[] } };

export function pickWikidataEntity(data: WdSearch, query: string): { id: string; label: string; description: string | null } | null {
  for (const s of data.search ?? []) {
    const names = [s.label ?? '', s.match?.text ?? '', ...(s.aliases ?? [])].filter(Boolean);
    const relevant = /(real estate|property|reit|apartment|housing|residential|landlord|management|developer|investment)/i.test(s.description ?? '');
    if (names.some((n) => sameEntity(n, query)) && relevant) return { id: s.id, label: s.label ?? query, description: s.description ?? null };
  }
  return null;
}

export function parseWikidataFacts(data: WdSparql): { website: string | null; hq: string | null } {
  const b = data.results?.bindings?.[0];
  return { website: b?.w?.value ?? null, hq: b?.hq?.value ?? null };
}

export async function lookupWikidata(name: string, ctx: FetchCtx): Promise<RegistryMatch | null> {
  const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=5&search=${encodeURIComponent(name)}`;
  const { data } = await fetchJson<WdSearch>({ sourceId: wikidata.id, url: searchUrl, deadline: ctx.deadline, timeoutMs: 8000, retries: 1, ttlMs: 30 * 24 * 3_600_000 });
  const entity = pickWikidataEntity(data, name);
  if (!entity) return null;
  const q = `SELECT ?w ?hq WHERE { OPTIONAL { wd:${entity.id} wdt:P856 ?w } OPTIONAL { wd:${entity.id} wdt:P159 ?h . ?h rdfs:label ?hq FILTER(lang(?hq)='en') } } LIMIT 1`;
  const sparqlUrl = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`;
  const facts = await fetchJson<WdSparql>({ sourceId: wikidata.id, url: sparqlUrl, deadline: ctx.deadline, timeoutMs: 10_000, retries: 1, ttlMs: 30 * 24 * 3_600_000, headers: { Accept: 'application/sparql-results+json' } });
  const f = parseWikidataFacts(facts.data);
  return { source: wikidata.id, name: entity.label, url: `https://www.wikidata.org/wiki/${entity.id}`, website: f.website, address: f.hq, id: entity.id, note: entity.description ?? undefined };
}

// --- SEC EDGAR ---------------------------------------------------------------
function secHeaders() {
  return { 'User-Agent': process.env.SEC_USER_AGENT?.trim() || 'PumaResearch/2.0 research@puma-utilities.vercel.app', Accept: 'application/json' };
}

type SecTickers = Record<string, { cik_str: number; ticker: string; title: string }>;
type SecSubmissions = { name?: string; sic?: string; sicDescription?: string; website?: string; phone?: string; addresses?: { business?: { street1?: string; city?: string; stateOrCountry?: string; zipCode?: string } } };

export function findSecCompany(tickers: SecTickers, name: string): { cik: string; title: string; ticker: string } | null {
  for (const row of Object.values(tickers)) {
    if (sameEntity(row.title, name)) return { cik: String(row.cik_str).padStart(10, '0'), title: row.title, ticker: row.ticker };
  }
  return null;
}

export function parseSecSubmissions(data: SecSubmissions, url: string): RegistryMatch {
  const b = data.addresses?.business;
  return {
    source: secEdgar.id,
    name: data.name ? titleCase(data.name) : '',
    url,
    website: data.website ? normalizeDomain(data.website) : null,
    phone: data.phone ?? null,
    address: b?.street1 ? `${b.street1}, ${b.city ?? ''} ${b.stateOrCountry ?? ''} ${b.zipCode ?? ''}`.replace(/\s+/g, ' ').trim() : null,
    isReit: data.sic === '6798' || /real estate investment trust/i.test(data.sicDescription ?? ''),
    note: data.sicDescription,
  };
}

export async function lookupSec(name: string, ctx: FetchCtx): Promise<RegistryMatch | null> {
  const { data } = await fetchJson<SecTickers>({ sourceId: secEdgar.id, url: 'https://www.sec.gov/files/company_tickers.json', headers: secHeaders(), deadline: ctx.deadline, ttlMs: 7 * 24 * 3_600_000, timeoutMs: 15_000, retries: 1 });
  const hit = findSecCompany(data, name);
  if (!hit) return null;
  const url = `https://data.sec.gov/submissions/CIK${hit.cik}.json`;
  const sub = await fetchJson<SecSubmissions>({ sourceId: secEdgar.id, url, headers: secHeaders(), deadline: ctx.deadline, ttlMs: 7 * 24 * 3_600_000, timeoutMs: 12_000, retries: 1 });
  return { ...parseSecSubmissions(sub.data, url), id: hit.cik, note: `${hit.ticker} · ${sub.data.sicDescription ?? ''}` };
}
