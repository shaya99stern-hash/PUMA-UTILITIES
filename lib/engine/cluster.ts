/**
 * Groups building records from many sources into portfolios (one dossier per prospect).
 *
 * Buildings are linked when they share:
 *  - an owner name of record (same LLC / corporation),
 *  - an owner mailing address (the strongest signal for NJ, where owner names are redacted),
 *  - a management agent (HUD management org, care-of name),
 * and records describing the same physical building (same BBL / address+zip) are merged first.
 * Mailing addresses that belong to tax-servicing companies or registered agents are not used as
 * links, so unrelated owners are not glued together. Pure module.
 */
import { companyNameKey } from '@/lib/text';
import { chooseName, emptyDossier, ingestRecord, isGenericOwner, isLawOrAgentName, isSingleAssetName, portfolioStats, type Dossier } from './dossier';
import type { PropertyRecord } from './types';

class UnionFind {
  parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

const KNOWN_SERVICE_STREETS = [
  /^1209 ORANGE ST\b/, /^251 LITTLE FALLS DR\b/, /^28 LIBERTY ST\b/, /^111 (8|EIGHTH) AVE\b/, /^80 STATE ST\b/, /^99 WASHINGTON AVE\b/,
  /^2711 CENTERVILLE RD\b/, /^1 COMMERCE (PLZ|PLAZA)\b/, /^818 W (7|SEVENTH) ST\b/, /^600 MAMARONECK AVE\b/,
];

export type ServiceAddressStats = { buildings: number; owners: Set<string>; cities: Set<string>; states: Set<string>; poBox: boolean; street: string };

/** Detects mailing addresses that are tax/escrow services or registered agents rather than an owner's office. */
export function isServiceAddress(stats: ServiceAddressStats, propertyStates: Set<string>): boolean {
  const street = stats.street;
  if (KNOWN_SERVICE_STREETS.some((re) => re.test(street))) return true;
  const outOfState = [...stats.states].some((s) => s && !propertyStates.has(s));
  if (stats.poBox && stats.owners.size >= 12) return true;
  if (stats.poBox && outOfState && stats.buildings >= 25 && stats.cities.size >= 6) return true;
  if (stats.owners.size >= 60 && stats.cities.size >= 15) return true;
  return false;
}

export type ClusterOptions = { maxLinkGroup?: number };

export function clusterRecords(records: PropertyRecord[], opts: ClusterOptions = {}): Dossier[] {
  const maxGroup = opts.maxLinkGroup ?? 600;
  const n = records.length;
  const uf = new UnionFind(n);
  const byKey = new Map<string, number[]>();
  const link = (key: string, i: number) => {
    const list = byKey.get(key);
    if (list) list.push(i);
    else byKey.set(key, [i]);
  };

  // Mailing address statistics for service-address detection.
  const mailStats = new Map<string, ServiceAddressStats>();
  const propertyStates = new Set(records.map((r) => r.state));
  records.forEach((r) => {
    if (!r.mailingKey) return;
    let s = mailStats.get(r.mailingKey);
    if (!s) {
      s = { buildings: 0, owners: new Set(), cities: new Set(), states: new Set(), poBox: r.mailingKey.startsWith('PO BOX'), street: r.mailingKey.split('|')[0] };
      mailStats.set(r.mailingKey, s);
    }
    s.buildings += 1;
    if (r.ownerName) s.owners.add(companyNameKey(r.ownerName));
    if (r.city) s.cities.add(r.city.toUpperCase());
    const extra = r.extra as { mailState?: string | null } | undefined;
    const mailState = extra?.mailState ?? (r.ownerMailingAddress?.match(/\b([A-Z]{2})\s+\d{5}\b/)?.[1] ?? null);
    if (mailState) s.states.add(mailState);
  });
  const serviceKeys = new Set([...mailStats.entries()].filter(([, s]) => isServiceAddress(s, propertyStates)).map(([k]) => k));

  records.forEach((r, i) => {
    link(`b:${r.sourceKey}`, i);
    for (const k of r.altKeys ?? []) link(`b:${k}`, i);
    if (r.ownerName && !isGenericOwner(r.ownerName) && !isLawOrAgentName(r.ownerName)) {
      const key = companyNameKey(r.ownerName);
      // Numbered single-asset LLCs only link exact duplicates (same building seen twice).
      if (key && !(isSingleAssetName(r.ownerName) && key.length < 6)) link(`o:${key}`, i);
    }
    if (r.mailingKey && !serviceKeys.has(r.mailingKey)) link(`m:${r.mailingKey}`, i);
    if (r.managerName && !isLawOrAgentName(r.managerName)) link(`g:${companyNameKey(r.managerName)}`, i);
  });

  for (const [key, members] of byKey) {
    if (members.length < 2) continue;
    if (!key.startsWith('b:') && members.length > maxGroup) continue;
    for (let j = 1; j < members.length; j += 1) uf.union(members[0], members[j]);
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i += 1) {
    const root = uf.find(i);
    const list = groups.get(root);
    if (list) list.push(i);
    else groups.set(root, [i]);
  }

  const dossiers: Dossier[] = [];
  for (const members of groups.values()) {
    const d = emptyDossier('', '');
    for (const i of members) ingestRecord(d, records[i]);
    chooseName(d);
    d.key = dossierKey(d);
    d.trail.push(describeCluster(d, members.map((i) => records[i])));
    dossiers.push(d);
  }
  return dossiers;
}

/** Stable identity for a dossier, used to dedupe candidates within a job. */
export function dossierKey(d: Dossier): string {
  const strong = [...d.aliases].filter((a) => a.kind !== 'owner' || !isSingleAssetName(a.name)).sort((a, b) => b.count - a.count)[0];
  if (strong) return `org:${strong.key}`;
  const mail = [...d.addresses].sort((a, b) => b.count - a.count)[0];
  if (mail) return `mail:${mail.key}`;
  return `bld:${d.buildings[0]?.key ?? Math.random().toString(36).slice(2)}`;
}

function describeCluster(d: Dossier, records: PropertyRecord[]): string {
  const sources = [...new Set(records.map((r) => r.provenance.sourceName))];
  const stats = portfolioStats(d);
  const parts = [`Grouped ${stats.buildings} building${stats.buildings === 1 ? '' : 's'} (${stats.units.toLocaleString()} units) from ${sources.join(', ')}`];
  const mailing = d.addresses.filter((a) => a.kind === 'mailing' && a.count > 1);
  if (mailing.length) parts.push(`linked by shared owner mailing address ${mailing[0].text}`);
  const owners = d.aliases.filter((a) => a.kind === 'owner' && a.count > 1);
  if (owners.length) parts.push(`same owner of record ${owners[0].name}`);
  const managers = d.aliases.filter((a) => a.kind === 'manager' || a.kind === 'careof');
  if (managers.length) parts.push(`managed by ${managers[0].name}`);
  return `${parts.join('; ')}.`;
}

/** Rough pre-research ranking so the most promising portfolios are researched first. */
export function prelimRank(d: Dossier): number {
  const stats = portfolioStats(d);
  const units = stats.units || (d.seed ? d.seed.count * 35 : 0);
  const buildings = stats.buildings || d.seed?.count || 0;
  const people = d.people.length ? 1.15 : 1;
  const contact = d.emails.length || d.people.some((p) => p.emails.length) ? 1.2 : 1;
  const multi = buildings >= 2 ? 1.25 : 0.6;
  return Math.round(Math.log10(1 + units) * 100 * people * contact * multi);
}

/** Merges dossiers that turned out to be the same prospect (shared buildings or same strong name). */
export function mergeDuplicates(dossiers: Dossier[]): Dossier[] {
  const out: Dossier[] = [];
  const index = new Map<string, Dossier>();
  for (const d of dossiers) {
    const keys = [
      ...d.aliases.filter((a) => a.kind !== 'owner' || !isSingleAssetName(a.name)).map((a) => `n:${a.key}`),
      ...d.buildings.slice(0, 50).map((b) => `b:${b.key}`),
    ];
    const hit = keys.map((k) => index.get(k)).find(Boolean);
    if (hit) {
      absorb(hit, d);
      for (const k of keys) index.set(k, hit);
    } else {
      out.push(d);
      for (const k of keys) index.set(k, d);
    }
  }
  for (const d of out) chooseName(d);
  return out;
}

export function absorb(into: Dossier, from: Dossier) {
  for (const b of from.buildings) {
    if (!into.buildings.some((x) => x.key === b.key || x.altKeys.includes(b.key) || b.altKeys.includes(x.key))) into.buildings.push(b);
  }
  for (const a of from.aliases) {
    const ex = into.aliases.find((x) => x.key === a.key && x.kind === a.kind);
    if (ex) ex.count += a.count;
    else into.aliases.push(a);
  }
  for (const a of from.addresses) if (!into.addresses.some((x) => x.key === a.key)) into.addresses.push(a);
  for (const p of from.people) if (!into.people.some((x) => x.key === p.key)) into.people.push(p);
  for (const e of from.emails) if (!into.emails.some((x) => x.email === e.email)) into.emails.push(e);
  for (const p of from.phones) if (!into.phones.some((x) => x.phone === p.phone)) into.phones.push(p);
  for (const dm of from.domains) if (!into.domains.some((x) => x.domain === dm.domain)) into.domains.push(dm);
  for (const [k, v] of Object.entries(from.sources)) if (!into.sources[k]) into.sources[k] = v;
  into.trail.push(...from.trail.filter((t) => !into.trail.includes(t)));
  if (!into.seed && from.seed) into.seed = from.seed;
}
