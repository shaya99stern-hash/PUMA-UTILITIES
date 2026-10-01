/**
 * The dossier is the engine's working record for one prospect (a portfolio owner or manager).
 * Resolvers keep adding facts to it from different sources; every fact keeps its sources so the
 * UI can show exactly how a name, phone number or email was found. Pure module (no I/O).
 */
import { addressKey } from '@/lib/text';
import { companyNameKey, displayOrgName, isFreeMailDomain, normalizeDomain, normalizeEmail, personKey, roleCategoryFor } from './text';
import type { PersonRecord, PropertyRecord } from './types';

export type RoleCategory = NonNullable<PersonRecord['roleCategory']>;
export type CompanyType = 'owner_operator' | 'property_manager' | 'developer' | 'reit' | 'nonprofit' | 'public_housing' | 'investor' | 'other' | 'unknown';
export type AliasKind = 'website' | 'manager' | 'agent' | 'careof' | 'registry' | 'process' | 'owner' | 'principal' | 'authority';

export type DSource = { name: string; url?: string; hits: number };
export type DAlias = { name: string; key: string; kind: AliasKind; count: number; src: string[] };
export type DAddress = { text: string; key: string; kind: 'mailing' | 'business' | 'process' | 'hq' | 'website'; count: number; src: string[] };
export type DEmail = { email: string; status: 'published' | 'inferred'; personKey?: string | null; confidence: number; src: string[] };
export type DPhone = { phone: string; label: string; src: string[] };
export type DPerson = {
  key: string;
  name: string;
  title: string | null;
  role: RoleCategory;
  decisionMaker: boolean;
  emails: DEmail[];
  phones: DPhone[];
  linkedin: string | null;
  org: string | null;
  address: string | null;
  buildings: number;
  src: string[];
};
export type DBuilding = {
  key: string;
  altKeys: string[];
  name: string | null;
  address: string;
  city: string | null;
  state: string;
  zip: string | null;
  county: string | null;
  lat: number | null;
  lon: number | null;
  units: number | null;
  unitsEstimated: boolean;
  yearBuilt: number | null;
  stories: number | null;
  buildingClass: string | null;
  bbl: string | null;
  parcelId: string | null;
  ownerName: string | null;
  mailingAddress: string | null;
  managerName: string | null;
  utilityName: string | null;
  utilityPwsid: string | null;
  reportedWaterKgal: number | null;
  reportedWaterYear: number | null;
  estAnnualWaterCost: number | null;
  src: string[];
};
export type DFact = { field: string; value: string; src: string; url?: string; method: 'api' | 'scrape' | 'inferred' | 'derived'; confidence: number; at: string };
export type ScoreFactor = { id: string; label: string; points: number; max: number; detail: string; known: boolean };

export type Dossier = {
  key: string;
  name: string;
  nameKind: AliasKind | 'address';
  nameConfidence: number;
  type: CompanyType;
  aliases: DAlias[];
  addresses: DAddress[];
  domains: { domain: string; verified: boolean; src: string[] }[];
  website: string | null;
  linkedin: string | null;
  /** External profile links (contactout company page, etc.). */
  links: Record<string, string>;
  /** Third-party managers seen on the owner's buildings (owner dossiers). */
  managers: { name: string; buildings: number; src: string }[];
  phones: DPhone[];
  emails: DEmail[];
  people: DPerson[];
  buildings: DBuilding[];
  sources: Record<string, DSource>;
  facts: DFact[];
  /** resolver task key -> outcome ("+3 buildings", "no match", "error: ..."). */
  done: Record<string, string>;
  /** Human-readable trail of how the dossier was built. */
  trail: string[];
  gaps: string[];
  portfolioClaims: { units?: number; buildings?: number; src: string }[];
  water: {
    utilities: { name: string; pwsid: string; buildings: number; meter: { status: string; label: string; detail: string; source: string | null }; angle: string }[];
    estAnnualSpend: number | null;
    estMonthlySpend: number | null;
    reportedKgal: number | null;
    basis: string | null;
  };
  /** Payment / distress signals: water-debt liens, HUD troubled status, failed inspections. */
  signals: { kind: 'water_lien' | 'tax_lien' | 'hud_troubled' | 'reac_fail' | 'low_dscr' | 'default'; severity: 'high' | 'medium' | 'info'; detail: string; building?: string; src: string }[];
  score: number | null;
  scoreConfidence: 'high' | 'medium' | 'low' | null;
  scoreFactors: ScoreFactor[];
  why: string[];
  /** Seeds from aggregated sources (HPD agents/officers) before their buildings are pulled. */
  seed?: { kind: 'hpd-agent' | 'hpd-officer' | 'pluto-owner'; label: string; count: number; first?: string; last?: string; zip?: string; house?: string; street?: string };
  status: 'pending' | 'enriching' | 'done';
  runs: number;
  prelimRank: number;
};

export function emptyDossier(key: string, name: string): Dossier {
  return {
    key, name, nameKind: 'owner', nameConfidence: 0.2, type: 'unknown', aliases: [], addresses: [], domains: [], website: null, linkedin: null, links: {}, managers: [],
    phones: [], emails: [], people: [], buildings: [], sources: {}, facts: [], done: {}, trail: [], gaps: [], portfolioClaims: [],
    water: { utilities: [], estAnnualSpend: null, estMonthlySpend: null, reportedKgal: null, basis: null }, signals: [], score: null, scoreConfidence: null, scoreFactors: [], why: [],
    status: 'pending', runs: 0, prelimRank: 0,
  };
}

// ---------------------------------------------------------------------------
// Merge helpers. Each returns true when something new was learned.
// ---------------------------------------------------------------------------
export function touchSource(d: Dossier, id: string, name: string, url?: string) {
  const s = d.sources[id];
  if (s) {
    s.hits += 1;
    if (!s.url && url) s.url = url;
  } else d.sources[id] = { name, url, hits: 1 };
}

function addSrc(list: string[], src: string) {
  if (!list.includes(src)) list.push(src);
}

export function addFact(d: Dossier, fact: Omit<DFact, 'at'>) {
  if (d.facts.some((f) => f.field === fact.field && f.value === fact.value && f.src === fact.src)) return;
  d.facts.push({ ...fact, at: new Date().toISOString() });
  if (d.facts.length > 400) d.facts.splice(0, d.facts.length - 400);
}

/** Single-asset entity names ("123 MAIN ST LLC", "HDFC") are poor display names. */
export function isSingleAssetName(name: string): boolean {
  const n = name.toUpperCase();
  return /^\d/.test(n.trim())
    || /\b\d{2,5}\s+[A-Z]+\s+(ST|STREET|AVE|AVENUE|RD|ROAD|BLVD|PL|PLACE|DR|DRIVE|LN|LANE|TER|CT)\b/.test(n)
    || /\b(H\.?D\.?F\.?C|HOUSING DEVELOPMENT FUND|OWNER LLC|OWNERS? CORP|PROPERTY OWNER|HOLDINGS? \d|PHASE \w+|TENANTS? CORP|CONDOMINIUM|CONDO|COOPERATIVE|APARTMENTS? CORP)\b/.test(n);
}

export function addAlias(d: Dossier, rawName: string, kind: AliasKind, src: string, count = 1): boolean {
  const name = rawName.replace(/\s+/g, ' ').trim();
  if (name.length < 3) return false;
  const key = companyNameKey(name);
  if (!key) return false;
  const existing = d.aliases.find((a) => a.key === key && a.kind === kind);
  if (existing) {
    existing.count += count;
    addSrc(existing.src, src);
    return false;
  }
  d.aliases.push({ name: displayOrgName(name), key, kind, count, src: [src] });
  return true;
}

export function addAddress(d: Dossier, text: string | null | undefined, kind: DAddress['kind'], src: string, key?: string | null, count = 1): boolean {
  if (!text) return false;
  const k = key || addressKey(text);
  if (!k || k.length < 6) return false;
  const existing = d.addresses.find((a) => a.key === k);
  if (existing) {
    existing.count += count;
    addSrc(existing.src, src);
    return false;
  }
  d.addresses.push({ text, key: k, kind, count, src: [src] });
  return true;
}

export function addDomain(d: Dossier, raw: string | null | undefined, src: string, verified = false): boolean {
  const domain = normalizeDomain(raw);
  if (!domain || isFreeMailDomain(domain) || /(\.gov|\.edu)$|linkedin\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|yelp\.com|google\.com|apartments\.com|zillow\.com|loopnet\.com|bbb\.org|bizapedia\.com|opencorporates\.com/.test(domain)) return false;
  const existing = d.domains.find((x) => x.domain === domain);
  if (existing) {
    addSrc(existing.src, src);
    if (verified && !existing.verified) {
      existing.verified = true;
      return true;
    }
    return false;
  }
  d.domains.push({ domain, verified, src: [src] });
  return true;
}

export function addPhone(d: Dossier, phone: string | null | undefined, label: string, src: string): boolean {
  if (!phone) return false;
  const existing = d.phones.find((p) => p.phone === phone);
  if (existing) {
    addSrc(existing.src, src);
    return false;
  }
  d.phones.push({ phone, label, src: [src] });
  return true;
}

export function addEmail(d: Dossier, raw: string | null | undefined, status: DEmail['status'], src: string, confidence: number, pKey?: string | null): boolean {
  const email = normalizeEmail(raw);
  if (!email) return false;
  const existing = d.emails.find((e) => e.email === email);
  if (existing) {
    addSrc(existing.src, src);
    if (status === 'published' && existing.status === 'inferred') {
      existing.status = 'published';
      existing.confidence = Math.max(existing.confidence, confidence);
      return true;
    }
    if (pKey && !existing.personKey) existing.personKey = pKey;
    return false;
  }
  d.emails.push({ email, status, personKey: pKey ?? null, confidence, src: [src] });
  return true;
}

export type PersonInput = {
  name: string;
  title?: string | null;
  role?: RoleCategory | null;
  decisionMaker?: boolean;
  email?: string | null;
  emailStatus?: DEmail['status'];
  phone?: string | null;
  linkedin?: string | null;
  org?: string | null;
  address?: string | null;
};

export function addPerson(d: Dossier, p: PersonInput, src: string): { person: DPerson; isNew: boolean; learned: boolean } {
  const key = personKey(p.name);
  let person = d.people.find((x) => x.key === key);
  let isNew = false;
  let learned = false;
  if (!person) {
    person = {
      key, name: p.name, title: p.title ?? null, role: p.role ?? roleCategoryFor(p.title), decisionMaker: Boolean(p.decisionMaker),
      emails: [], phones: [], linkedin: null, org: p.org ?? null, address: p.address ?? null, buildings: 0, src: [src],
    };
    d.people.push(person);
    isNew = true;
    learned = true;
  } else {
    addSrc(person.src, src);
    if (!person.title && p.title) { person.title = p.title; learned = true; }
    if (p.title && person.title && person.title.length < p.title.length && /\b(president|ceo|principal|owner|director|vp|vice|partner|chief)\b/i.test(p.title)) person.title = p.title;
    if (p.decisionMaker && !person.decisionMaker) { person.decisionMaker = true; learned = true; }
    if (!person.org && p.org) person.org = p.org;
    if (!person.address && p.address) person.address = p.address;
    const role = p.role ?? (p.title ? roleCategoryFor(p.title) : null);
    if (role && rolePriority(role) > rolePriority(person.role)) person.role = role;
  }
  person.buildings += 1;
  if (p.email) {
    const email = normalizeEmail(p.email);
    if (email) {
      const status = p.emailStatus ?? 'published';
      const existing = person.emails.find((e) => e.email === email);
      if (!existing) {
        person.emails.push({ email, status, personKey: key, confidence: status === 'published' ? 0.9 : 0.5, src: [src] });
        learned = true;
      } else {
        addSrc(existing.src, src);
        if (status === 'published' && existing.status === 'inferred') { existing.status = 'published'; existing.confidence = 0.9; learned = true; }
      }
      if (addEmail(d, email, status, src, status === 'published' ? 0.9 : 0.5, key)) learned = true;
    }
  }
  if (p.phone && !person.phones.some((x) => x.phone === p.phone)) {
    person.phones.push({ phone: p.phone, label: 'direct', src: [src] });
    learned = true;
  }
  if (p.linkedin && !person.linkedin) { person.linkedin = p.linkedin; learned = true; }
  return { person, isNew, learned };
}

export function rolePriority(role: RoleCategory): number {
  return { owner: 7, executive: 6, operations: 5, property_manager: 4, finance: 3, maintenance: 2, leasing: 1, other: 0 }[role] ?? 0;
}

/** Ranks people for outreach: decision makers with a reachable channel first. */
export function rankPeople(people: DPerson[]): DPerson[] {
  const score = (p: DPerson) =>
    (p.decisionMaker ? 40 : 0)
    + rolePriority(p.role) * 5
    + (p.emails.some((e) => e.status === 'published') ? 25 : p.emails.length ? 12 : 0)
    + (p.phones.length ? 8 : 0)
    + Math.min(15, p.buildings * 2)
    + Math.min(10, p.src.length * 3);
  return [...people].sort((a, b) => score(b) - score(a));
}

export function buildingFromRecord(r: PropertyRecord): DBuilding {
  return {
    key: r.sourceKey,
    altKeys: r.altKeys ?? [],
    name: r.name ?? null,
    address: r.address,
    city: r.city ?? null,
    state: r.state,
    zip: r.zip ?? null,
    county: r.county ?? null,
    lat: r.lat ?? null,
    lon: r.lon ?? null,
    units: r.units ?? null,
    unitsEstimated: Boolean(r.unitsEstimated),
    yearBuilt: r.yearBuilt ?? null,
    stories: r.stories ?? null,
    buildingClass: r.buildingClass ?? null,
    bbl: r.bbl ?? null,
    parcelId: r.parcelId ?? null,
    ownerName: r.ownerName ?? null,
    mailingAddress: r.ownerMailingAddress ?? null,
    managerName: r.managerName ?? null,
    utilityName: r.utilityName ?? null,
    utilityPwsid: r.utilityPwsid ?? null,
    reportedWaterKgal: r.reportedWaterKgal ?? null,
    reportedWaterYear: r.reportedWaterYear ?? null,
    estAnnualWaterCost: null,
    src: [r.provenance.sourceId],
  };
}

/** Adds a building; merges with an existing one when any key overlaps. Returns true if new. */
export function addBuilding(d: Dossier, b: DBuilding): boolean {
  const keys = new Set([b.key, ...b.altKeys]);
  const existing = d.buildings.find((x) => keys.has(x.key) || x.altKeys.some((k) => keys.has(k)));
  if (!existing) {
    d.buildings.push(b);
    return true;
  }
  for (const k of [b.key, ...b.altKeys]) if (k !== existing.key && !existing.altKeys.includes(k)) existing.altKeys.push(k);
  for (const s of b.src) addSrc(existing.src, s);
  // Prefer reported unit counts over estimates.
  if (b.units && (!existing.units || (existing.unitsEstimated && !b.unitsEstimated))) {
    existing.units = b.units;
    existing.unitsEstimated = b.unitsEstimated;
  }
  const fill = <K extends keyof DBuilding>(k: K) => {
    if ((existing[k] === null || existing[k] === undefined) && b[k] !== null && b[k] !== undefined) existing[k] = b[k];
  };
  (['name', 'city', 'zip', 'county', 'lat', 'lon', 'yearBuilt', 'stories', 'buildingClass', 'bbl', 'parcelId', 'ownerName', 'mailingAddress', 'managerName', 'utilityName', 'utilityPwsid', 'reportedWaterKgal', 'reportedWaterYear'] as const).forEach(fill);
  return false;
}

/** Ingests a building record and the people/organizations it names. */
export function ingestRecord(d: Dossier, r: PropertyRecord): { newBuilding: boolean; learned: boolean } {
  const src = r.provenance.sourceId;
  touchSource(d, src, r.provenance.sourceName, r.provenance.url);
  const newBuilding = addBuilding(d, buildingFromRecord(r));
  let learned = newBuilding;
  if (r.ownerName && !isGenericOwner(r.ownerName)) learned = addAlias(d, r.ownerName, 'owner', src) || learned;
  if (r.managerName) learned = addAlias(d, r.managerName, src.startsWith('hud') ? 'manager' : 'careof', src) || learned;
  if (r.ownerMailingAddress) learned = addAddress(d, r.ownerMailingAddress, 'mailing', src, r.mailingKey) || learned;
  for (const p of r.people ?? []) {
    const res = addPerson(d, {
      name: p.fullName, title: p.title, role: p.roleCategory, decisionMaker: p.isDecisionMaker, email: p.email,
      emailStatus: p.emailStatus === 'inferred' ? 'inferred' : 'published', phone: p.phone, linkedin: p.linkedinUrl, org: p.organization, address: p.address,
    }, src);
    learned = res.learned || learned;
    if (p.address) learned = addAddress(d, p.address, 'business', src) || learned;
    if (p.email) {
      const domain = p.email.split('@')[1];
      if (domain) learned = addDomain(d, domain, src) || learned;
    }
  }
  const extra = r.extra as { mgmtPhone?: string | null; mgmtAddress?: string | null; onSitePhone?: string | null; haPhone?: string | null; haEmail?: string | null } | undefined;
  if (extra?.mgmtPhone) learned = addPhone(d, extra.mgmtPhone, 'management office', src) || learned;
  if (extra?.mgmtAddress) learned = addAddress(d, extra.mgmtAddress, 'business', src) || learned;
  if (extra?.haPhone) learned = addPhone(d, extra.haPhone, 'main office', src) || learned;
  if (extra?.haEmail) learned = addEmail(d, extra.haEmail, 'published', src, 0.85) || learned;
  return { newBuilding, learned };
}

export function isGenericOwner(name: string): boolean {
  return /^(UNAVAILABLE|NAME NOT ON FILE|OWNER|UNKNOWN|N\/A|NYC HOUSING AUTHORITY$)/i.test(name.trim()) || name.trim().length < 3;
}

// ---------------------------------------------------------------------------
// Derived views
// ---------------------------------------------------------------------------
export function portfolioStats(d: Dossier) {
  const units = d.buildings.reduce((s, b) => s + (b.units ?? 0), 0);
  const estimated = d.buildings.some((b) => b.unitsEstimated);
  const years = d.buildings.map((b) => b.yearBuilt).filter((y): y is number => !!y);
  const avgYear = years.length ? Math.round(years.reduce((s, y) => s + y, 0) / years.length) : null;
  const states = [...new Set(d.buildings.map((b) => b.state))];
  const claimedUnits = Math.max(0, ...d.portfolioClaims.map((c) => c.units ?? 0));
  const claimedBuildings = Math.max(0, ...d.portfolioClaims.map((c) => c.buildings ?? 0));
  return { buildings: d.buildings.length, units, unitsEstimated: estimated, avgYearBuilt: avgYear, states, claimedUnits: claimedUnits || null, claimedBuildings: claimedBuildings || null };
}

/** Business email domain (verified first). */
export function primaryDomain(d: Dossier): string | null {
  const verified = d.domains.find((x) => x.verified);
  if (verified) return verified.domain;
  const counted = [...d.domains].sort((a, b) => b.src.length - a.src.length);
  return counted[0]?.domain ?? null;
}

const NAME_WEIGHT: Record<AliasKind, number> = { website: 0.95, registry: 0.9, manager: 0.88, agent: 0.86, careof: 0.8, authority: 0.9, process: 0.55, owner: 0.5, principal: 0.4 };

/** Picks the best display name from the aliases gathered so far. */
export function chooseName(d: Dossier): void {
  const candidates = d.aliases
    .filter((a) => !isLawOrAgentName(a.name))
    .map((a) => {
      let w = NAME_WEIGHT[a.kind] ?? 0.4;
      if (a.kind === 'owner' && isSingleAssetName(a.name)) w *= 0.35;
      if (a.kind === 'owner' && a.count >= 2) w += Math.min(0.25, a.count * 0.03);
      if (/\b(management|mgmt|realty|properties|property|residential|apartments|partners|group|companies|housing authority|development)\b/i.test(a.name)) w += 0.06;
      w += Math.min(0.1, (a.src.length - 1) * 0.05);
      return { a, w };
    })
    .sort((x, y) => y.w - x.w);
  const best = candidates[0];
  if (best) {
    d.name = best.a.name;
    d.nameKind = best.a.kind;
    d.nameConfidence = Math.min(0.99, best.w);
    return;
  }
  const dm = rankPeople(d.people).find((p) => p.role === 'owner' || p.decisionMaker);
  if (dm) {
    d.name = `${dm.name} (owner)`;
    d.nameKind = 'principal';
    d.nameConfidence = 0.35;
    return;
  }
  const addr = [...d.addresses].sort((a, b) => b.count - a.count)[0];
  if (addr) {
    d.name = `Owner at ${addr.text}`;
    d.nameKind = 'address';
    d.nameConfidence = 0.1;
  }
}

export function isLawOrAgentName(name: string): boolean {
  return /\b(C ?T CORPORATION|CORPORATION SERVICE|REGISTERED AGENTS?|NATIONAL REGISTERED|INCORP SERVICES|LEGALINC|NORTHWEST REGISTERED|COGENCY|UNITED STATES CORPORATION AGENTS|ESQ|ESQUIRE|LAW (FIRM|OFFICES?|GROUP)|ATTORNEYS?|LLP$|P\.?C\.?$|SECRETARY OF STATE|TAX (DEPT|SERVICE)|CORELOGIC|LERETA|ESCROW)\b/i.test(name);
}

export function inferCompanyType(d: Dossier): CompanyType {
  const names = d.aliases.map((a) => a.name).join(' | ');
  if (/housing authority|\bpha\b/i.test(names) || d.aliases.some((a) => a.kind === 'authority')) return 'public_housing';
  if (/\breit\b|real estate investment trust/i.test(names)) return 'reit';
  if (/\bh\.?d\.?f\.?c\b|housing development fund|non-?profit|community (development|housing)|\bministries\b|\bchurch\b/i.test(names)) return 'nonprofit';
  const hasManager = d.aliases.some((a) => (a.kind === 'manager' || a.kind === 'agent' || a.kind === 'careof') && /management|mgmt|residential|services|realty/i.test(a.name));
  const best = d.nameKind;
  if (hasManager && (best === 'manager' || best === 'agent' || best === 'careof')) return 'property_manager';
  if (/development|developers?\b/i.test(d.name)) return 'developer';
  if (/capital|investments?|equities|fund|partners\b/i.test(d.name)) return 'investor';
  return d.buildings.length ? 'owner_operator' : 'unknown';
}

/** Short list of what is still missing — drives the UI and further research. */
export function computeGaps(d: Dossier): string[] {
  const gaps: string[] = [];
  const ranked = rankPeople(d.people);
  if (d.nameKind === 'address' || d.nameConfidence < 0.4) gaps.push('Company name not confirmed');
  if (!ranked.some((p) => p.decisionMaker)) gaps.push('No decision maker named yet');
  if (!d.emails.length && !ranked.some((p) => p.emails.length)) gaps.push('No email found');
  if (!d.phones.length && !ranked.some((p) => p.phones.length)) gaps.push('No phone found');
  if (!d.website) gaps.push('Website not found');
  if (!d.water.utilities.length) gaps.push('Water utility not resolved');
  return gaps;
}
