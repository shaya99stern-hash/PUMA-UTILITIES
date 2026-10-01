/**
 * NYC HPD Multiple Dwelling Registrations (tesw-yqqr) + Registration Contacts (feu5-w2e2).
 * Gives the registered owner entity, head officers and the managing agent for each building.
 */
import { addressKey } from '@/lib/text';
import { displayOrgName, displayPersonName, isDecisionMakerTitle, isGenericName, mailingKey, roleCategoryFor, titleCase, trimOrNull, zip5 } from '../text';
import type { PersonRecord, Provenance, SourceInfo } from '../types';
import { chunk, provenance, socrataRows, soql, type FetchCtx } from './common';

export const nycHpd: SourceInfo = {
  id: 'nyc-hpd',
  name: 'NYC HPD Multiple Dwelling Registrations',
  kind: 'discovery',
  coverage: ['NY'],
  coverageLabel: 'New York City',
  capabilities: ['owner_entity', 'managing_agent', 'officers', 'business_address', 'site_manager'],
  description: 'Annual registrations for every NYC building with 3+ units: owner LLC, head officers, managing agent and business addresses.',
  homepage: 'https://data.cityofnewyork.us/Housing-Development/Multiple-Dwelling-Registrations/tesw-yqqr',
  verified: 'live',
};

export const HPD_REG_URL = 'https://data.cityofnewyork.us/resource/tesw-yqqr.json';
export const HPD_CONTACTS_URL = 'https://data.cityofnewyork.us/resource/feu5-w2e2.json';

export type HpdRegistration = { registrationId: string; buildingId: string | null; bin: string | null; bbl: string; address: string; zip: string | null; lastRegistered: string | null };

export type HpdContact = {
  registrationId: string;
  type: string;
  corporationName: string | null;
  person: string | null;
  title: string | null;
  businessAddress: string | null;
  businessKey: string | null;
};

export type HpdBuildingParties = {
  registrationId: string;
  owners: { name: string; addressKey: string | null; address: string | null }[];
  agent: { name: string | null; person: string | null; address: string | null; addressKey: string | null } | null;
  people: PersonRecord[];
};

export function parseRegistrations(rows: Record<string, string>[]): HpdRegistration[] {
  return rows.flatMap((r) => {
    const boro = Number(r.boroid);
    const block = Number(r.block);
    const lot = Number(r.lot);
    if (!boro || !Number.isFinite(block) || !Number.isFinite(lot) || !r.registrationid) return [];
    const bbl = `${boro}${String(block).padStart(5, '0')}${String(lot).padStart(4, '0')}`;
    return [{
      registrationId: String(r.registrationid),
      buildingId: r.buildingid ?? null,
      bin: r.bin ?? null,
      bbl,
      address: titleCase(`${r.housenumber ?? ''} ${r.streetname ?? ''}`.trim()),
      zip: zip5(r.zip),
      lastRegistered: r.lastregistrationdate ?? null,
    }];
  });
}

export function parseContacts(rows: Record<string, string>[]): HpdContact[] {
  return rows.map((r) => {
    const street = [r.businesshousenumber, r.businessstreetname].filter(Boolean).join(' ').trim();
    const address = street ? `${titleCase(street)}${r.businessapartment ? ` ${r.businessapartment}` : ''}, ${titleCase(r.businesscity ?? '')} ${r.businessstate ?? ''} ${r.businesszip ?? ''}`.replace(/\s+/g, ' ').replace(/ ,/g, ',').trim() : null;
    const person = [r.firstname, r.lastname].filter(Boolean).join(' ').trim();
    return {
      registrationId: String(r.registrationid),
      type: r.type ?? 'Unknown',
      corporationName: isGenericName(r.corporationname) ? null : trimOrNull(r.corporationname),
      person: person ? displayPersonName(r.firstname, r.lastname) : null,
      title: trimOrNull(r.title) ?? trimOrNull(r.contactdescription),
      businessAddress: address,
      businessKey: street ? mailingKey(street, r.businesscity, r.businesszip) : null,
    };
  });
}

const TYPE_TITLE: Record<string, string> = {
  HeadOfficer: 'Head Officer',
  IndividualOwner: 'Owner',
  CorporateOwner: 'Owner (corporate)',
  JointOwner: 'Joint Owner',
  Officer: 'Officer',
  Shareholder: 'Shareholder',
  Agent: 'Managing Agent',
  SiteManager: 'Site Manager',
  Lessee: 'Lessee',
};

/** Groups contacts per registration into owner entities, the managing agent and named people. */
export function buildingParties(contacts: HpdContact[], url: string): Map<string, HpdBuildingParties> {
  const out = new Map<string, HpdBuildingParties>();
  const prov: Provenance = provenance(nycHpd, url);
  for (const c of contacts) {
    let entry = out.get(c.registrationId);
    if (!entry) {
      entry = { registrationId: c.registrationId, owners: [], agent: null, people: [] };
      out.set(c.registrationId, entry);
    }
    if (c.type === 'CorporateOwner' && c.corporationName) {
      entry.owners.push({ name: c.corporationName, address: c.businessAddress, addressKey: c.businessKey });
    }
    if (c.type === 'Agent') {
      entry.agent = { name: c.corporationName, person: c.person, address: c.businessAddress, addressKey: c.businessKey };
    }
    if (c.person) {
      const typeTitle = TYPE_TITLE[c.type] ?? c.type;
      const title = c.title && !/^(GEN\.?PART|CORP|LLC|INDIV|OTHER)$/i.test(c.title) ? `${titleCase(c.title)} (${typeTitle})` : typeTitle;
      const isDm = ['HeadOfficer', 'IndividualOwner', 'JointOwner', 'Officer', 'Shareholder'].includes(c.type) || (c.type === 'Agent' && !!c.corporationName);
      entry.people.push({
        fullName: c.person,
        title,
        roleCategory: roleCategoryFor(c.title, c.type),
        isDecisionMaker: isDm || isDecisionMakerTitle(c.title, c.type),
        address: c.businessAddress,
        organization: c.corporationName ? displayOrgName(c.corporationName) : null,
        provenance: prov,
      });
    }
  }
  return out;
}

/** Registrations for a list of BBLs (batched OR clauses). */
export async function fetchRegistrationsByBbl(bbls: string[], ctx: FetchCtx) {
  const regs: HpdRegistration[] = [];
  const urls: string[] = [];
  for (const group of chunk(bbls, 40)) {
    const where = group
      .map((b) => `(boroid=${soql(String(Number(b[0])))} AND block=${soql(String(Number(b.slice(1, 6))))} AND lot=${soql(String(Number(b.slice(6))))})`)
      .join(' OR ');
    const { rows, url } = await socrataRows(nycHpd, HPD_REG_URL, {
      $select: 'registrationid,buildingid,bin,boroid,block,lot,housenumber,streetname,zip,lastregistrationdate',
      $where: where,
      $limit: 1000,
    }, ctx, { ttlMs: 7 * 24 * 3_600_000 });
    regs.push(...parseRegistrations(rows));
    urls.push(url);
  }
  return { registrations: regs, urls };
}

export async function fetchContactsByRegistration(ids: string[], ctx: FetchCtx) {
  const contacts: HpdContact[] = [];
  let lastUrl = HPD_CONTACTS_URL;
  for (const group of chunk([...new Set(ids)], 100)) {
    const { rows, url } = await socrataRows(nycHpd, HPD_CONTACTS_URL, {
      $where: `registrationid in (${group.map(soql).join(',')})`,
      $limit: 5000,
    }, ctx, { ttlMs: 7 * 24 * 3_600_000 });
    contacts.push(...parseContacts(rows));
    lastUrl = url;
  }
  return { contacts, url: lastUrl };
}

/** Contacts whose corporation name matches (used to enrich an existing company). */
export async function searchContactsByCorporation(name: string, ctx: FetchCtx, limit = 500) {
  const term = name.toUpperCase().replace(/[^A-Z0-9 &]/g, ' ').replace(/\s+/g, ' ').trim();
  const { rows, url } = await socrataRows(nycHpd, HPD_CONTACTS_URL, {
    $where: `upper(corporationname) like ${soql(`%${term}%`)}`,
    $limit: limit,
  }, ctx);
  return { contacts: parseContacts(rows), url };
}

/** Contacts registered at a business street address (cross-reference for owner mailing addresses). */
export async function searchContactsByAddress(houseNumber: string, streetStart: string, zip: string, ctx: FetchCtx) {
  const { rows, url } = await socrataRows(nycHpd, HPD_CONTACTS_URL, {
    $where: `businesshousenumber=${soql(houseNumber)} AND businesszip=${soql(zip)} AND upper(businessstreetname) like ${soql(`${streetStart.toUpperCase()}%`)}`,
    $limit: 200,
  }, ctx);
  return { contacts: parseContacts(rows), url };
}

export function hpdAddressKey(address: string, zip: string | null) {
  return `${addressKey(address)}|${zip ?? ''}`;
}

/** All registrations held by a person (head officer / owner / agent), across LLCs. */
export async function searchContactsByPerson(first: string, last: string, ctx: FetchCtx, zip?: string | null, limit = 500) {
  const where = [`upper(firstname)=${soql(first.toUpperCase())}`, `upper(lastname)=${soql(last.toUpperCase())}`];
  if (zip) where.push(`businesszip=${soql(zip)}`);
  const { rows, url } = await socrataRows(nycHpd, HPD_CONTACTS_URL, { $where: where.join(' AND '), $limit: limit }, ctx, { ttlMs: 7 * 24 * 3_600_000 });
  return { contacts: parseContacts(rows), url };
}

/** Registrations (buildings) by registration id. */
export async function fetchRegistrationsByIds(ids: string[], ctx: FetchCtx) {
  const registrations: HpdRegistration[] = [];
  let lastUrl = HPD_REG_URL;
  for (const group of chunk([...new Set(ids)], 100)) {
    const { rows, url } = await socrataRows(nycHpd, HPD_REG_URL, {
      $select: 'registrationid,buildingid,bin,boroid,block,lot,housenumber,streetname,zip,lastregistrationdate',
      $where: `registrationid in (${group.map(soql).join(',')})`,
      $limit: 1000,
    }, ctx, { ttlMs: 7 * 24 * 3_600_000 });
    registrations.push(...parseRegistrations(rows));
    lastUrl = url;
  }
  return { registrations, url: lastUrl };
}

export type HpdSeed = { kind: 'agent' | 'officer'; label: string; count: number; first?: string; last?: string; house?: string; street?: string; zip?: string; url: string };

/** Managing agents ranked by number of registered NYC buildings (citywide). */
export async function fetchTopAgents(limit: number, ctx: FetchCtx): Promise<HpdSeed[]> {
  const { rows, url } = await socrataRows<{ corporationname?: string; n?: string }>(nycHpd, HPD_CONTACTS_URL, {
    $select: 'corporationname,count(registrationid) as n',
    $where: `type='Agent' AND corporationname IS NOT NULL`,
    $group: 'corporationname',
    $order: 'n desc',
    $limit: limit,
  }, ctx, { ttlMs: 7 * 24 * 3_600_000 });
  return rows.flatMap((r) => (r.corporationname && !isGenericName(r.corporationname) ? [{ kind: 'agent' as const, label: r.corporationname, count: Number(r.n ?? 0), url }] : []));
}

/** Head officers (the people behind owner LLCs) ranked by number of registered buildings. */
export async function fetchTopHeadOfficers(limit: number, ctx: FetchCtx): Promise<HpdSeed[]> {
  const { rows, url } = await socrataRows<Record<string, string>>(nycHpd, HPD_CONTACTS_URL, {
    $select: 'firstname,lastname,businesshousenumber,businessstreetname,businesszip,count(registrationid) as n',
    $where: `type in ('HeadOfficer','IndividualOwner') AND firstname IS NOT NULL AND lastname IS NOT NULL`,
    $group: 'firstname,lastname,businesshousenumber,businessstreetname,businesszip',
    $order: 'n desc',
    $limit: limit,
  }, ctx, { ttlMs: 7 * 24 * 3_600_000 });
  return rows.map((r) => ({
    kind: 'officer' as const,
    label: displayPersonName(r.firstname, r.lastname),
    count: Number(r.n ?? 0),
    first: r.firstname,
    last: r.lastname,
    house: r.businesshousenumber,
    street: r.businessstreetname,
    zip: r.businesszip,
    url,
  }));
}
