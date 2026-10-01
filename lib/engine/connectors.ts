/**
 * User-configurable connectors (Settings > Connectors). Anything added here is picked up by the
 * engine automatically and cross-referenced with the built-in sources:
 *
 *  - buildings: a Socrata / ArcGIS / JSON dataset of buildings (any city or county open data portal)
 *               with a field mapping -> discovered and clustered like the built-in parcel sources.
 *  - people:    keyed people/email providers (Hunter.io, or any JSON API with a name/domain
 *               template) -> decision makers, titles, emails, email format.
 *  - company:   company registries (OpenCorporates, or any JSON API) -> officers, registered
 *               address (which then feeds the address cross-references), website.
 *  - search:    web search API keys (Brave, Serper, Google CSE) -> websites, LinkedIn, ContactOut.
 *
 * Secrets are stored encrypted; each connector has a daily request cap.
 */
import { addAddress, addAlias, addDomain, addFact, addPerson, addPhone, primaryDomain, touchSource, type Dossier } from './dossier';
import { fetchJson } from './http';
import { configureSearchKeys } from './sources/web-search';
import { arcgisUrl, provenance } from './sources/common';
import { cleanPhone, displayOrgName, isDecisionMakerTitle, mailingKey, normalizeEmail, roleCategoryFor, streetKey, titleCase, toInt, toNumber, trimOrNull, validYear, zip5 } from './text';
import type { FetchCtx } from './sources/common';
import type { PropertyRecord } from './types';

export type ConnectorRole = 'buildings' | 'people' | 'company' | 'search';
export type ConnectorKind = 'socrata' | 'arcgis' | 'json' | 'hunter' | 'opencorporates' | 'brave' | 'serper' | 'google_cse';

export type FieldMap = Partial<Record<
  'id' | 'address' | 'city' | 'state' | 'zip' | 'units' | 'owner' | 'mailing_street' | 'mailing_city' | 'mailing_zip' | 'lat' | 'lon' | 'year_built'
  | 'manager' | 'contact_name' | 'contact_title' | 'contact_email' | 'contact_phone' | 'name' | 'title' | 'email' | 'phone' | 'linkedin' | 'website' | 'company',
  string
>>;

export type ConnectorConfig = {
  /** Socrata resource URL (https://data.city.gov/resource/abcd-1234.json), ArcGIS layer URL, or JSON URL template. */
  url?: string;
  /** Socrata $where / ArcGIS where. May use {state} and {min_units}. */
  where?: string;
  /** Path to the array of rows in a JSON response, e.g. "data.items". */
  rowsPath?: string;
  fields?: FieldMap;
  /** Default state for building rows that do not include one. */
  state?: string;
  /** States this connector covers (buildings role). Empty = any. */
  states?: string[];
  /** Auth header name for JSON connectors (value comes from the secret). */
  authHeader?: string;
  /** Query-string parameter name for the API key (alternative to a header). */
  authParam?: string;
  /** Google CSE engine id. */
  cx?: string;
  /** OpenCorporates jurisdiction filter, e.g. "us_nj". */
  jurisdiction?: string;
  maxRows?: number;
};

export type ConnectorRow = {
  id: string;
  name: string;
  kind: ConnectorKind;
  role: ConnectorRole;
  enabled: boolean;
  config: ConnectorConfig;
  secret_enc: string | null;
  daily_limit: number;
  usage: { date?: string; count?: number } | null;
};

export type LoadedConnector = {
  id: string;
  name: string;
  kind: ConnectorKind;
  role: ConnectorRole;
  config: ConnectorConfig;
  secret: string | null;
  dailyLimit: number;
  /** Input identity for enrichment connectors (dedupes repeated runs on the same dossier). */
  inputKey: (d: Dossier) => string | null;
};

export const CONNECTOR_PRESETS: { kind: ConnectorKind; role: ConnectorRole; name: string; needsSecret: boolean; description: string; signupUrl?: string; defaults?: ConnectorConfig; dailyLimit: number }[] = [
  { kind: 'socrata', role: 'buildings', name: 'Open data dataset (Socrata)', needsSecret: false, dailyLimit: 500, description: 'Any city/county/state open data portal on Socrata (data.<city>.gov). Map the address, units and owner columns.' },
  { kind: 'arcgis', role: 'buildings', name: 'ArcGIS parcel / building layer', needsSecret: false, dailyLimit: 500, description: 'Any county parcel FeatureServer/MapServer layer. Map the address, units, owner and owner-mailing columns.' },
  { kind: 'json', role: 'buildings', name: 'JSON API (buildings)', needsSecret: false, dailyLimit: 300, description: 'Any JSON endpoint returning a list of buildings. Use {state} and {min_units} in the URL.' },
  { kind: 'hunter', role: 'people', name: 'Hunter.io', needsSecret: true, dailyLimit: 25, signupUrl: 'https://hunter.io/api-keys', description: 'Emails, names and job titles for a company domain, plus its email format (free plan: 25 searches/month).' },
  { kind: 'opencorporates', role: 'company', name: 'OpenCorporates', needsSecret: true, dailyLimit: 50, signupUrl: 'https://opencorporates.com/api_accounts/new', description: 'LLC / corporation records for NJ, NY, PA and beyond: officers and registered addresses, which feed the address cross-references.' },
  { kind: 'json', role: 'people', name: 'JSON API (people)', needsSecret: false, dailyLimit: 50, description: 'Any people/contact API. URL template can use {name}, {domain}, {city}, {state}, {address}.' },
  { kind: 'json', role: 'company', name: 'JSON API (company)', needsSecret: false, dailyLimit: 50, description: 'Any company lookup API. URL template can use {name}, {domain}, {city}, {state}, {address}.' },
  { kind: 'brave', role: 'search', name: 'Brave Search API', needsSecret: true, dailyLimit: 60, signupUrl: 'https://brave.com/search/api/', description: 'Web search for websites, LinkedIn and ContactOut profiles (free tier ~2,000 queries/month).' },
  { kind: 'serper', role: 'search', name: 'Serper (Google results)', needsSecret: true, dailyLimit: 80, signupUrl: 'https://serper.dev', description: 'Google search results API (2,500 free queries).' },
  { kind: 'google_cse', role: 'search', name: 'Google Programmable Search', needsSecret: true, dailyLimit: 90, signupUrl: 'https://programmablesearchengine.google.com', description: 'Google Custom Search JSON API (100 free queries/day). Needs the engine ID (cx).' },
];

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------
export function getPath(obj: unknown, path: string | undefined): unknown {
  if (!path) return obj;
  return path.split('.').reduce<unknown>((cur, key) => {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur) && /^\d+$/.test(key)) return cur[Number(key)];
    return (cur as Record<string, unknown>)[key];
  }, obj);
}

export function renderTemplate(template: string, values: Record<string, string | number | null | undefined>, encode = true): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = values[key];
    if (v === null || v === undefined) return '';
    return encode ? encodeURIComponent(String(v)) : String(v);
  });
}

function field(row: unknown, map: FieldMap | undefined, key: keyof FieldMap): unknown {
  const path = map?.[key];
  return path ? getPath(row, path) : undefined;
}

/** Maps generic rows to building records (exported for tests). */
export function mapBuildingRows(rows: unknown[], c: Pick<LoadedConnector, 'id' | 'name' | 'config'>, url: string): PropertyRecord[] {
  const prov = provenance({ id: `conn:${c.id}`, name: c.name }, url);
  const map = c.config.fields;
  return rows.flatMap((row, i) => {
    const address = trimOrNull(field(row, map, 'address'));
    if (!address) return [];
    const state = (trimOrNull(field(row, map, 'state')) ?? c.config.state ?? '').toUpperCase().slice(0, 2);
    if (!state) return [];
    const zip = zip5(trimOrNull(field(row, map, 'zip')));
    const id = trimOrNull(field(row, map, 'id')) ?? `${streetKey(address)}|${zip ?? i}`;
    const mStreet = trimOrNull(field(row, map, 'mailing_street'));
    const mCity = trimOrNull(field(row, map, 'mailing_city'));
    const mZip = zip5(trimOrNull(field(row, map, 'mailing_zip')));
    const owner = trimOrNull(field(row, map, 'owner'));
    const manager = trimOrNull(field(row, map, 'manager'));
    const contactName = trimOrNull(field(row, map, 'contact_name'));
    const contactTitle = trimOrNull(field(row, map, 'contact_title'));
    const email = normalizeEmail(trimOrNull(field(row, map, 'contact_email')));
    return [{
      sourceKey: `conn-${c.id}:${id}`,
      altKeys: zip ? [`addr:${streetKey(address)}|${zip}`] : [],
      address: titleCase(address),
      city: trimOrNull(field(row, map, 'city')) ? titleCase(String(field(row, map, 'city'))) : null,
      state,
      zip,
      lat: toNumber(field(row, map, 'lat')),
      lon: toNumber(field(row, map, 'lon')),
      units: toInt(field(row, map, 'units')),
      yearBuilt: validYear(field(row, map, 'year_built')),
      ownerName: owner,
      ownerMailingAddress: mStreet ? `${titleCase(mStreet)}, ${mCity ? titleCase(mCity) : ''} ${mZip ?? ''}`.replace(/\s+/g, ' ').trim() : null,
      mailingKey: mStreet ? mailingKey(mStreet, mCity, mZip) : null,
      managerName: manager ? displayOrgName(manager) : null,
      people: contactName ? [{
        fullName: titleCase(contactName),
        title: contactTitle,
        roleCategory: roleCategoryFor(contactTitle),
        isDecisionMaker: isDecisionMakerTitle(contactTitle),
        email,
        emailStatus: email ? 'published' as const : 'unknown' as const,
        phone: cleanPhone(trimOrNull(field(row, map, 'contact_phone'))),
        organization: manager ?? owner,
        provenance: prov,
      }] : [],
      provenance: prov,
    }];
  });
}

async function connectorFetch<T>(c: LoadedConnector, url: string, ctx: FetchCtx, headers: Record<string, string> = {}, ttlMs = 7 * 24 * 3_600_000) {
  const h = { ...headers };
  let finalUrl = url;
  if (c.secret && c.config.authHeader) h[c.config.authHeader] = c.secret;
  if (c.secret && c.config.authParam) finalUrl += `${finalUrl.includes('?') ? '&' : '?'}${encodeURIComponent(c.config.authParam)}=${encodeURIComponent(c.secret)}`;
  return fetchJson<T>({ sourceId: `conn:${c.id}`, url: finalUrl, headers: h, deadline: ctx.deadline, timeoutMs: 15_000, retries: 1, ttlMs });
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------
export async function runBuildingConnector(c: LoadedConnector, q: { state: string; minUnits: number }, page: { offset: number; limit: number }, ctx: FetchCtx): Promise<{ records: PropertyRecord[]; raw: number; url: string }> {
  const vars = { state: q.state, min_units: q.minUnits };
  const limit = Math.min(page.limit, c.config.maxRows ?? 2000);
  if (c.kind === 'socrata') {
    const u = new URL(c.config.url!);
    if (c.config.where) u.searchParams.set('$where', renderTemplate(c.config.where, vars, false));
    u.searchParams.set('$limit', String(limit));
    u.searchParams.set('$offset', String(page.offset));
    const { data } = await connectorFetch<unknown[]>(c, u.toString(), ctx, c.secret && !c.config.authHeader ? { 'X-App-Token': c.secret } : {});
    const rows = Array.isArray(data) ? data : [];
    return { records: mapBuildingRows(rows, c, u.toString()), raw: rows.length, url: u.toString() };
  }
  if (c.kind === 'arcgis') {
    const url = arcgisUrl(c.config.url!, { where: c.config.where ? renderTemplate(c.config.where, vars, false) : '1=1', outFields: '*', returnGeometry: false, resultOffset: page.offset, resultRecordCount: limit });
    const { data } = await connectorFetch<{ features?: { attributes: unknown }[] }>(c, url, ctx);
    const rows = (data.features ?? []).map((f) => f.attributes);
    return { records: mapBuildingRows(rows, c, url), raw: rows.length, url };
  }
  const url = renderTemplate(c.config.url!, { ...vars, offset: page.offset, limit });
  const { data } = await connectorFetch<unknown>(c, url, ctx);
  const rows = getPath(data, c.config.rowsPath);
  const list = Array.isArray(rows) ? rows : [];
  return { records: mapBuildingRows(list, c, url), raw: list.length, url };
}

// ---------------------------------------------------------------------------
// Enrichment (people / company)
// ---------------------------------------------------------------------------
function dossierVars(d: Dossier) {
  const addr = [...d.addresses].sort((a, b) => b.count - a.count)[0];
  return {
    name: d.nameKind === 'address' ? null : d.name.replace(/\s*\(owner\)$/, ''),
    domain: primaryDomain(d),
    city: d.buildings[0]?.city ?? null,
    state: d.buildings[0]?.state ?? null,
    address: addr?.text ?? null,
  };
}

export function inputKeyFor(kind: ConnectorKind, role: ConnectorRole, config: ConnectorConfig): (d: Dossier) => string | null {
  return (d) => {
    const v = dossierVars(d);
    if (kind === 'hunter') return v.domain;
    if (kind === 'opencorporates') return v.name && d.nameConfidence >= 0.3 ? v.name.toLowerCase() : null;
    if (kind === 'json') {
      const tpl = config.url ?? '';
      const needs = [...tpl.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as keyof typeof v);
      if (needs.some((k) => !v[k])) return null;
      return needs.map((k) => v[k]).join('|') || null;
    }
    return role === 'people' ? v.domain : v.name;
  };
}

type HunterResponse = { data?: { domain?: string; organization?: string; pattern?: string; emails?: { value: string; type?: string; confidence?: number; first_name?: string; last_name?: string; position?: string; seniority?: string; phone_number?: string; linkedin?: string }[] } };
type OcResponse = { results?: { companies?: { company: { name: string; company_number: string; jurisdiction_code: string; registered_address_in_full?: string; current_status?: string; opencorporates_url?: string; officers?: { officer: { name: string; position?: string } }[] } }[] } };
type OcCompany = { results?: { company?: { name: string; registered_address_in_full?: string; officers?: { officer: { name: string; position?: string; end_date?: string | null } }[]; opencorporates_url?: string } } };

const HUNTER_PATTERN: Record<string, string> = { '{first}.{last}': 'first.last', '{f}{last}': 'flast', '{first}': 'first', '{first}{last}': 'firstlast', '{f}.{last}': 'f.last', '{first}{l}': 'firstl', '{first}_{last}': 'first_last', '{last}.{first}': 'last.first', '{last}{f}': 'lastf', '{last}': 'last' };

export async function runEnrichmentConnectors(d: Dossier, c: LoadedConnector, ctx: FetchCtx): Promise<string> {
  const v = dossierVars(d);
  const src = `conn:${c.id}`;
  if (!(await consumeQuota(c))) return 'daily limit reached';
  if (c.kind === 'hunter') {
    if (!v.domain || !c.secret) return 'no domain';
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(v.domain)}&limit=25&api_key=${encodeURIComponent(c.secret)}`;
    const { data } = await fetchJson<HunterResponse>({ sourceId: src, url, deadline: ctx.deadline, timeoutMs: 15_000, retries: 1, ttlMs: 30 * 24 * 3_600_000 });
    touchSource(d, src, c.name, `https://hunter.io/search/${v.domain}`);
    let people = 0;
    for (const e of data.data?.emails ?? []) {
      const name = [e.first_name, e.last_name].filter(Boolean).join(' ');
      if (name) {
        addPerson(d, { name, title: e.position ?? null, role: roleCategoryFor(e.position), decisionMaker: isDecisionMakerTitle(e.position) || e.seniority === 'executive', email: e.value, emailStatus: 'published', phone: cleanPhone(e.phone_number ?? null), linkedin: e.linkedin ?? null }, src);
        people += 1;
      }
    }
    const pattern = data.data?.pattern ? HUNTER_PATTERN[data.data.pattern] ?? null : null;
    if (pattern) addFact(d, { field: 'email_format', value: `${pattern}@${v.domain}`, src, method: 'api', confidence: 0.85 });
    if (data.data?.organization) addAlias(d, data.data.organization, 'website', src);
    addDomain(d, v.domain, src, true);
    return `${people} people with emails`;
  }
  if (c.kind === 'opencorporates') {
    if (!v.name) return 'no name';
    const jur = c.config.jurisdiction ? `&jurisdiction_code=${encodeURIComponent(c.config.jurisdiction)}` : '';
    const url = `https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(v.name)}${jur}&per_page=5${c.secret ? `&api_token=${encodeURIComponent(c.secret)}` : ''}`;
    const { data } = await fetchJson<OcResponse>({ sourceId: src, url, deadline: ctx.deadline, timeoutMs: 15_000, retries: 1, ttlMs: 30 * 24 * 3_600_000 });
    const hits = (data.results?.companies ?? []).map((x) => x.company).filter((co) => co.current_status !== 'Dissolved');
    if (!hits.length) return 'no match';
    touchSource(d, src, c.name, hits[0].opencorporates_url);
    let people = 0;
    for (const co of hits.slice(0, 2)) {
      if (co.registered_address_in_full) addAddress(d, titleCase(co.registered_address_in_full), 'process', src);
      addFact(d, { field: 'legal_entity', value: `${co.name} (${co.jurisdiction_code} #${co.company_number})`, src, url: co.opencorporates_url, method: 'api', confidence: 0.85 });
      const detailUrl = `https://api.opencorporates.com/v0.4/companies/${co.jurisdiction_code}/${co.company_number}${c.secret ? `?api_token=${encodeURIComponent(c.secret)}` : ''}`;
      try {
        const { data: detail } = await fetchJson<OcCompany>({ sourceId: src, url: detailUrl, deadline: ctx.deadline, timeoutMs: 12_000, retries: 0, ttlMs: 30 * 24 * 3_600_000 });
        for (const o of detail.results?.company?.officers ?? []) {
          if (o.officer.end_date) continue;
          addPerson(d, { name: titleCase(o.officer.name), title: o.officer.position ? titleCase(o.officer.position) : 'Officer', role: roleCategoryFor(o.officer.position, 'officer'), decisionMaker: true }, src);
          people += 1;
        }
      } catch {
        // detail is optional
      }
    }
    return `${hits.length} entities, ${people} officers`;
  }
  if (c.kind === 'json') {
    const url = renderTemplate(c.config.url ?? '', v);
    const { data } = await connectorFetch<unknown>(c, url, ctx, {}, 14 * 24 * 3_600_000);
    const rows = getPath(data, c.config.rowsPath);
    const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
    touchSource(d, src, c.name);
    let n = 0;
    for (const row of list.slice(0, 50)) {
      const map = c.config.fields;
      const name = trimOrNull(field(row, map, 'name'));
      const title = trimOrNull(field(row, map, 'title'));
      const email = normalizeEmail(trimOrNull(field(row, map, 'email')));
      const phone = cleanPhone(trimOrNull(field(row, map, 'phone')));
      if (c.role === 'people' && name) {
        addPerson(d, { name: titleCase(name), title, role: roleCategoryFor(title), decisionMaker: isDecisionMakerTitle(title), email, emailStatus: 'published', phone, linkedin: trimOrNull(field(row, map, 'linkedin')) }, src);
        n += 1;
      } else if (c.role === 'company') {
        const website = trimOrNull(field(row, map, 'website'));
        const company = trimOrNull(field(row, map, 'company'));
        if (website) addDomain(d, website, src);
        if (company) addAlias(d, company, 'registry', src);
        if (phone) addPhone(d, phone, c.name, src);
        if (email) addFact(d, { field: 'email', value: email, src, method: 'api', confidence: 0.7 });
        const addr = trimOrNull(field(row, map, 'address'));
        if (addr) addAddress(d, addr, 'hq', src);
        n += 1;
      }
    }
    return n ? `${n} records` : 'no match';
  }
  return 'unsupported';
}

// ---------------------------------------------------------------------------
// Loading + quotas (DB; imported lazily so the module stays testable)
// ---------------------------------------------------------------------------
async function db() {
  return (await import('@/lib/server/db')).sql();
}

async function consumeQuota(c: LoadedConnector): Promise<boolean> {
  if (!process.env.DATABASE_URL) return true;
  const today = new Date().toISOString().slice(0, 10);
  const rows = await (await db())<{ ok: boolean }[]>`
    update connectors set usage = case when usage->>'date' = ${today}
        then jsonb_build_object('date', ${today}, 'count', coalesce((usage->>'count')::int, 0) + 1)
        else jsonb_build_object('date', ${today}, 'count', 1) end
    where id = ${c.id} and (usage->>'date' is distinct from ${today} or coalesce((usage->>'count')::int, 0) < daily_limit)
    returning true as ok`;
  return Boolean(rows[0]?.ok);
}

export async function loadConnectors(workspaceId: string): Promise<LoadedConnector[]> {
  if (!process.env.DATABASE_URL) return [];
  const { decryptSecret } = await import('@/lib/server/crypto');
  const rows = await (await db())<ConnectorRow[]>`select * from connectors where workspace_id = ${workspaceId} and enabled order by created_at`;
  const loaded = rows.map((r) => {
    let secret: string | null = null;
    try {
      secret = r.secret_enc ? decryptSecret(r.secret_enc) : null;
    } catch {
      secret = null;
    }
    return { id: r.id, name: r.name, kind: r.kind, role: r.role, config: r.config ?? {}, secret, dailyLimit: r.daily_limit, inputKey: inputKeyFor(r.kind, r.role, r.config ?? {}) };
  });
  const searchKeys: Parameters<typeof configureSearchKeys>[0] = {};
  for (const c of loaded) {
    if (c.role !== 'search' || !c.secret) continue;
    if (c.kind === 'brave') searchKeys.brave ??= c.secret;
    if (c.kind === 'serper') searchKeys.serper ??= c.secret;
    if (c.kind === 'google_cse' && c.config.cx) searchKeys.google ??= { key: c.secret, cx: c.config.cx };
  }
  configureSearchKeys(searchKeys);
  return loaded;
}

/** Runs a connector once with sample input (Settings "Test" button). */
export async function testConnector(c: LoadedConnector, sample: { state?: string; name?: string; domain?: string }): Promise<{ ok: boolean; message: string; sample: unknown[] }> {
  const ctx = { deadline: Date.now() + 20_000 };
  try {
    if (c.role === 'buildings') {
      const r = await runBuildingConnector(c, { state: sample.state ?? c.config.state ?? 'NJ', minUnits: 5 }, { offset: 0, limit: 5 }, ctx);
      return { ok: r.raw > 0, message: `${r.raw} rows returned, ${r.records.length} mapped to buildings`, sample: r.records.slice(0, 3).map((x) => ({ address: x.address, city: x.city, state: x.state, units: x.units, owner: x.ownerName, mailing: x.ownerMailingAddress })) };
    }
    if (c.role === 'search') {
      const { search } = await import('./sources/web-search');
      configureSearchKeys(c.kind === 'brave' ? { brave: c.secret ?? undefined } : c.kind === 'serper' ? { serper: c.secret ?? undefined } : { google: c.secret && c.config.cx ? { key: c.secret, cx: c.config.cx } : undefined });
      const hits = await search(sample.name ?? 'Glenwood Management New York', ctx, 3);
      return { ok: hits.length > 0, message: `${hits.length} results`, sample: hits };
    }
    const { emptyDossier } = await import('./dossier');
    const d = emptyDossier('test', sample.name ?? 'Denholtz Properties');
    d.nameConfidence = 0.9;
    d.nameKind = 'website';
    if (sample.domain ?? 'denholtz.com') d.domains.push({ domain: sample.domain ?? 'denholtz.com', verified: true, src: ['test'] });
    const outcome = await runEnrichmentConnectors(d, c, ctx);
    return { ok: !/no |unsupported|limit/.test(outcome), message: outcome, sample: d.people.slice(0, 5).map((p) => ({ name: p.name, title: p.title, email: p.emails[0]?.email ?? null })) };
  } catch (error) {
    return { ok: false, message: (error as Error).message, sample: [] };
  }
}
