/**
 * The cross-reference engine.
 *
 * A dossier starts with whatever discovery found (a building cluster, an agent name, a mailing
 * address, a person). Every resolver looks at what is known and asks another source about it:
 *   name    -> HUD management records, HPD registrations, NY DOS, PLUTO/OPA owners, registries
 *   address -> who else uses this mailing/business address (HPD, HUD, NY DOS, NJ, Philadelphia)
 *   person  -> every other building and LLC registered to that person
 *   domain  -> website crawl (team, contact, emails, phone, portfolio), ContactOut page
 *   emails  -> learned company format -> inferred emails for decision makers
 *   building-> coordinates -> water utility (EPA), reported water use (LL84), water-debt liens
 * Each answer can unlock new questions; the loop runs until nothing new is learned or the
 * research budget for this prospect is used up. Every step is written to the dossier trail.
 */
import { companyNameKey } from '@/lib/text';
import {
  addAddress, addAlias, addDomain, addEmail, addFact, addPerson, addPhone, chooseName, computeGaps, ingestRecord, isLawOrAgentName,
  isSingleAssetName, portfolioStats, primaryDomain, rankPeople, touchSource, type Dossier,
} from './dossier';
import { inferEmail, isRoleAddress, learnPattern, nameParts, type Pattern } from './emails';
import { describeError, SourceError } from './http';
import { censusGeocoder, geocodeAddress } from './sources/census-geocoder';
import type { FetchCtx } from './sources/common';
import { contactOut, contactOutLookupUrl, fetchContactOutCompany, findContactOutUrl, isContactOutCompanyUrl } from './sources/contactout';
import { hasMx } from './sources/dns';
import { epaWater, waterSystemAt } from './sources/epa-water';
import { fetchHudByMgmtStreet, fetchHudByOrg, hudAssisted } from './sources/hud-multifamily';
import { fetchNjCentroids, fetchNjParcelsByMailing, njModiv } from './sources/nj-modiv';
import { nyDos, searchDosByAddress, searchDosByName } from './sources/ny-dos';
import {
  buildingParties, fetchContactsByRegistration, fetchRegistrationsByIds, nycHpd, searchContactsByAddress, searchContactsByCorporation,
  searchContactsByPerson, type HpdContact,
} from './sources/nyc-hpd';
import { fetchLl84ByBbl, nycLl84 } from './sources/nyc-ll84';
import { fetchPlutoLots, nycPluto } from './sources/nyc-pluto';
import { fetchOpaByMailing, fetchOpaByOwner, phlOpa } from './sources/phl-opa';
import { fetchMontcoByMailing, fetchMontcoByOwner, montcoParcels } from './sources/pa-counties';
import { gleif, lookupGleif, lookupSec, lookupWikidata, secEdgar, wikidata } from './sources/registries';
import { fetchLiensByBbl, hudHealth, nycLiens, reacNumber } from './sources/signals';
import { search, searchProvider, webSearch } from './sources/web-search';
import { cleanPhone, displayOrgName, displayPersonName, isDecisionMakerTitle, looksLikePerson, normalizeDomain, roleCategoryFor, splitName, streetKey, titleCase, zip5 } from './text';
import type { PropertyRecord } from './types';
import { estimateWater } from './water';
import { crawlSite, domainOfUrl, guessDomain, probeDomain, WEBSITE_SOURCE } from './website';
import { runEnrichmentConnectors, type LoadedConnector } from './connectors';

export type ResolveCtx = FetchCtx & {
  deadline: number;
  log?: (level: 'info' | 'warn' | 'success', message: string, source?: string) => void;
  /** User-configured enrichment connectors (Settings > Connectors). */
  connectors?: LoadedConnector[];
  /** Hard cap of buildings kept per dossier. */
  maxBuildings?: number;
};

type Task = { key: string; label: string; run: () => Promise<string> };

const MAX_BUILDINGS = 400;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function note(d: Dossier, text: string) {
  if (!d.trail.includes(text)) d.trail.push(text);
  if (d.trail.length > 80) d.trail.splice(0, d.trail.length - 80);
}

function topNames(d: Dossier, limit = 3) {
  return [...d.aliases]
    .filter((a) => !isLawOrAgentName(a.name) && !(a.kind === 'owner' && isSingleAssetName(a.name)) && a.key.length >= 4)
    .sort((a, b) => b.count - a.count || b.src.length - a.src.length)
    .slice(0, limit);
}

function topAddresses(d: Dossier, limit = 3) {
  return [...d.addresses].filter((a) => /^\d/.test(a.text.trim())).sort((a, b) => b.count - a.count).slice(0, limit);
}

/** "210 Hudson St Ste 400, Jersey City NJ 07311" -> { house, street, zip } */
export function splitStreet(text: string): { house: string; streetStart: string; street: string; zip: string | null } | null {
  const first = text.split(',')[0].trim().toUpperCase();
  const m = first.match(/^(\d+[A-Z]?(?:-\d+)?)\s+(.+)$/);
  if (!m) return null;
  const zip = zip5(text.match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/)?.[1] ?? null);
  const streetWords = m[2].replace(/[.,#]/g, ' ').split(/\s+/).filter(Boolean);
  return { house: m[1], streetStart: streetWords.slice(0, 2).join(' '), street: first, zip };
}

function cap(d: Dossier, ctx: ResolveCtx) {
  return d.buildings.length >= (ctx.maxBuildings ?? MAX_BUILDINGS);
}

function ingestAll(d: Dossier, records: PropertyRecord[], ctx: ResolveCtx): number {
  let added = 0;
  for (const r of records) {
    if (cap(d, ctx)) break;
    if (ingestRecord(d, r).newBuilding) added += 1;
  }
  return added;
}

function isRoleName(name: string) {
  return /^(executive director|property manager|site manager|managing agent|management contact|owner|office)$/i.test(name.trim());
}

/** HPD contacts -> people, aliases and registrations for this dossier. */
function absorbHpdContacts(d: Dossier, contacts: HpdContact[], url: string, mode: 'agent' | 'owner', agentKey?: string) {
  const parties = buildingParties(contacts, url);
  touchSource(d, nycHpd.id, nycHpd.name, url);
  const managers = new Map<string, number>();
  for (const p of parties.values()) {
    if (p.agent?.name) {
      const key = companyNameKey(p.agent.name);
      if (mode === 'agent' && (!agentKey || key === agentKey)) {
        addAlias(d, p.agent.name, 'agent', nycHpd.id);
        if (p.agent.address) addAddress(d, p.agent.address, 'business', nycHpd.id, p.agent.addressKey);
      } else if (mode === 'owner') managers.set(displayOrgName(p.agent.name), (managers.get(displayOrgName(p.agent.name)) ?? 0) + 1);
    }
    for (const person of p.people) {
      const isAgentPerson = /Managing Agent/.test(person.title ?? '');
      if (mode === 'agent' && !isAgentPerson) continue;
      if (mode === 'owner' && isAgentPerson) continue;
      addPerson(d, { name: person.fullName, title: person.title, role: person.roleCategory, decisionMaker: person.isDecisionMaker, org: person.organization, address: person.address }, nycHpd.id);
    }
    if (mode === 'owner') for (const o of p.owners) addAlias(d, o.name, 'owner', nycHpd.id);
  }
  for (const [name, count] of managers) {
    const existing = d.managers.find((m) => m.name === name);
    if (existing) existing.buildings += count;
    else d.managers.push({ name, buildings: count, src: nycHpd.id });
  }
  return parties;
}

/** Registrations -> buildings with unit counts from PLUTO. */
async function expandRegistrations(d: Dossier, regIds: string[], ctx: ResolveCtx, limit = 250): Promise<number> {
  const ids = [...new Set(regIds)].slice(0, limit);
  if (!ids.length) return 0;
  const { registrations, url } = await fetchRegistrationsByIds(ids, ctx);
  touchSource(d, nycHpd.id, nycHpd.name, url);
  const bbls = [...new Set(registrations.map((r) => r.bbl))];
  const lots = new Map<string, PropertyRecord>();
  for (let i = 0; i < bbls.length; i += 100) {
    if (Date.now() > ctx.deadline - 2500) break;
    const { records } = await fetchPlutoLots({ bbls: bbls.slice(i, i + 100), minUnits: 1 }, { offset: 0, limit: 1000 }, ctx);
    for (const r of records) if (r.bbl) lots.set(r.bbl, r);
  }
  if (lots.size) touchSource(d, nycPluto.id, nycPluto.name);
  const records: PropertyRecord[] = registrations.map((reg) => lots.get(reg.bbl) ?? {
    sourceKey: `nyc-bbl:${reg.bbl}`,
    altKeys: [`bbl:${reg.bbl}`],
    address: reg.address,
    city: 'New York',
    state: 'NY',
    zip: reg.zip,
    bbl: reg.bbl,
    parcelId: reg.bbl,
    provenance: { sourceId: nycHpd.id, sourceName: nycHpd.name, url, retrievedAt: new Date().toISOString() },
  });
  // Owner names from PLUTO are LLCs; keep them as aliases but they do not rename a manager dossier.
  return ingestAll(d, records.map((r) => (d.nameKind === 'agent' || d.nameKind === 'manager' ? { ...r, ownerName: null } : r)), ctx);
}

// ---------------------------------------------------------------------------
// Task planning
// ---------------------------------------------------------------------------
export function planTasks(d: Dossier, ctx: ResolveCtx): Task[] {
  const tasks: Task[] = [];
  const add = (key: string, label: string, run: () => Promise<string>) => {
    if (!(key in d.done)) tasks.push({ key, label, run });
  };
  const states = new Set(d.buildings.map((b) => b.state));
  const inNyc = d.buildings.some((b) => b.bbl) || d.seed?.kind?.startsWith('hpd') || d.addresses.some((a) => /\b1[01]\d{3}\b/.test(a.text));

  // 1. Seeds from aggregated discovery: pull their buildings first.
  if (d.seed?.kind === 'hpd-agent') {
    const seed = d.seed;
    add(`hpd-corp:${companyNameKey(seed.label)}`, `NYC HPD registrations managed by ${seed.label}`, async () => {
      const { contacts, url } = await searchContactsByCorporation(seed.label, ctx, 1500);
      const exact = contacts.filter((c) => c.corporationName && companyNameKey(c.corporationName) === companyNameKey(seed.label));
      const regIds = [...new Set(exact.filter((c) => c.type === 'Agent').map((c) => c.registrationId))];
      const { contacts: all } = await fetchContactsByRegistration(regIds.slice(0, 40), ctx);
      absorbHpdContacts(d, [...exact, ...all.filter((c) => c.type === 'Agent')], url, 'agent', companyNameKey(seed.label));
      const added = await expandRegistrations(d, regIds, ctx);
      if (seed.count > regIds.length || seed.count > added) d.portfolioClaims.push({ buildings: seed.count, src: nycHpd.id });
      note(d, `NYC HPD lists ${seed.label} as managing agent on ${seed.count.toLocaleString()} registered buildings; pulled ${added} with unit counts from PLUTO.`);
      return `+${added} buildings`;
    });
  }
  if (d.seed?.kind === 'hpd-officer' && d.seed.first && d.seed.last) {
    const seed = d.seed;
    add(`hpd-person:${seed.first}|${seed.last}|${seed.zip ?? ''}`, `NYC buildings registered to ${seed.label}`, async () => {
      const { contacts, url } = await searchContactsByPerson(seed.first!, seed.last!, ctx, seed.zip ?? null, 1500);
      const regIds = [...new Set(contacts.map((c) => c.registrationId))];
      const { contacts: all } = await fetchContactsByRegistration(regIds.slice(0, 60), ctx);
      absorbHpdContacts(d, all.length ? all : contacts, url, 'owner');
      addPerson(d, { name: seed.label, title: 'Head Officer (HPD)', role: 'owner', decisionMaker: true, address: [seed.house, seed.street].filter(Boolean).join(' ') || null }, nycHpd.id);
      const added = await expandRegistrations(d, regIds, ctx);
      if (seed.count > added) d.portfolioClaims.push({ buildings: seed.count, src: nycHpd.id });
      note(d, `${seed.label} is the head officer on ${seed.count.toLocaleString()} NYC registrations; pulled ${added} buildings and the LLCs that hold them.`);
      return `+${added} buildings`;
    });
  }

  // 2. Name-based cross-references.
  for (const alias of topNames(d, 3)) {
    const term = alias.name;
    add(`hud-org:${alias.key}`, `HUD properties managed by ${term}`, async () => {
      const records = await fetchHudByOrg(term, ctx);
      const matching = records.filter((r) => r.managerName && companyNameKey(r.managerName) === alias.key);
      const added = ingestAll(d, matching, ctx);
      if (matching.length) note(d, `HUD lists ${term} as management agent on ${matching.length} assisted/insured properties (+${added} new), with named contacts.`);
      return matching.length ? `+${added} buildings, ${matching.length} matches` : 'no match';
    });
    if (inNyc || alias.kind === 'agent' || alias.kind === 'manager' || alias.kind === 'careof') {
      add(`hpd-corp:${alias.key}`, `NYC HPD registrations naming ${term}`, async () => {
        const { contacts, url } = await searchContactsByCorporation(term, ctx, 800);
        const exact = contacts.filter((c) => c.corporationName && companyNameKey(c.corporationName) === alias.key);
        if (!exact.length) return 'no match';
        const asAgent = exact.filter((c) => c.type === 'Agent');
        const mode = asAgent.length >= exact.length / 2 ? 'agent' : 'owner';
        const regIds = [...new Set(exact.map((c) => c.registrationId))];
        const { contacts: all } = await fetchContactsByRegistration(regIds.slice(0, 40), ctx);
        absorbHpdContacts(d, mode === 'agent' ? [...exact, ...all.filter((c) => c.type === 'Agent')] : all.length ? all : exact, url, mode, alias.key);
        const added = await expandRegistrations(d, regIds, ctx, 150);
        note(d, `NYC HPD: ${term} appears on ${regIds.length} building registrations as ${mode === 'agent' ? 'managing agent' : 'owner'} (+${added} buildings, officers added).`);
        return `+${added} buildings`;
      });
    }
    if (alias.kind !== 'principal') {
      add(`dos-name:${alias.key}`, `NY Dept. of State entity ${term}`, async () => {
        const hits = await searchDosByName(term, ctx, 8);
        const exact = hits.filter((h) => companyNameKey(h.name) === alias.key);
        if (!exact.length) return 'no match';
        touchSource(d, nyDos.id, nyDos.name, exact[0].url);
        for (const h of exact.slice(0, 3)) {
          if (h.processAddress && !/registered agent|corporation service|c t corp/i.test(h.processName ?? '')) addAddress(d, h.processAddress, 'process', nyDos.id, h.processKey);
          if (h.processName && !looksLikePerson(h.processName) && !isLawOrAgentName(h.processName)) addAlias(d, h.processName, 'process', nyDos.id);
          if (h.processName && looksLikePerson(h.processName)) addPerson(d, { name: h.processName, title: 'Service of process (NY DOS)', role: 'owner', decisionMaker: true, address: h.processAddress }, nyDos.id);
          addFact(d, { field: 'legal_entity', value: `${h.name} (NY DOS #${h.dosId}, ${h.entityType ?? 'entity'}, filed ${h.filedOn ?? '?'})`, src: nyDos.id, url: h.url, method: 'api', confidence: 0.9 });
        }
        note(d, `NY Department of State: ${exact[0].name} (DOS #${exact[0].dosId}) — process address ${exact[0].processAddress ?? 'n/a'}.`);
        return `${exact.length} entities`;
      });
    }
    if ((states.has('PA') || alias.kind === 'owner') && alias.kind !== 'principal') {
      add(`opa-owner:${alias.key}`, `Philadelphia parcels owned by ${term}`, async () => {
        const { records, url } = await fetchOpaByOwner(term, ctx);
        const matching = records.filter((r) => r.ownerName && companyNameKey(r.ownerName) === alias.key);
        if (!matching.length) return 'no match';
        touchSource(d, phlOpa.id, phlOpa.name, url);
        const added = ingestAll(d, matching, ctx);
        note(d, `Philadelphia OPA: ${term} owns ${matching.length} apartment parcels (+${added}).`);
        return `+${added} buildings`;
      });
    }
    if ((states.has('PA') || alias.kind === 'owner' || alias.kind === 'careof') && alias.kind !== 'principal') {
      add(`montco-owner:${alias.key}`, `Montgomery County PA parcels owned by ${term}`, async () => {
        const { records, url } = await fetchMontcoByOwner(term, ctx);
        const matching = records.filter((r) => (r.ownerName && companyNameKey(r.ownerName) === alias.key) || (r.managerName && companyNameKey(r.managerName) === alias.key));
        if (!matching.length) return 'no match';
        touchSource(d, montcoParcels.id, montcoParcels.name, url);
        const added = ingestAll(d, matching, ctx);
        note(d, `Montgomery County PA: ${term} holds ${matching.length} apartment parcels (+${added}).`);
        return `+${added} buildings`;
      });
    }
    if (inNyc && (alias.kind === 'owner' || alias.kind === 'registry' || alias.kind === 'process')) {
      add(`pluto-owner:${alias.key}`, `NYC lots owned by ${term}`, async () => {
        const { records, url } = await fetchPlutoLots({ minUnits: 3, ownerLike: [term.toUpperCase().replace(/[^A-Z0-9 &]+/g, ' ').trim()] }, { offset: 0, limit: 300 }, ctx);
        const matching = records.filter((r) => r.ownerName && companyNameKey(r.ownerName) === alias.key);
        if (!matching.length) return 'no match';
        touchSource(d, nycPluto.id, nycPluto.name, url);
        const added = ingestAll(d, matching, ctx);
        note(d, `NYC PLUTO: ${term} is owner of record on ${matching.length} residential lots (+${added}).`);
        return `+${added} buildings`;
      });
    }
  }

  // 3. Address-based cross-references (who else uses this mailing / business address?).
  for (const addr of topAddresses(d, 3)) {
    const parts = splitStreet(addr.text);
    if (!parts) continue;
    const akey = streetKey(parts.street) + (parts.zip ? `|${parts.zip}` : '');
    if (parts.zip) {
      add(`hpd-addr:${akey}`, `NYC HPD contacts at ${addr.text}`, async () => {
        const { contacts, url } = await searchContactsByAddress(parts.house, parts.streetStart, parts.zip!, ctx);
        if (!contacts.length) return 'no match';
        const agents = contacts.filter((c) => c.type === 'Agent' && c.corporationName);
        const owners = contacts.filter((c) => c.type !== 'Agent');
        touchSource(d, nycHpd.id, nycHpd.name, url);
        const agentNames = [...new Set(agents.map((c) => c.corporationName!))];
        for (const n of agentNames.slice(0, 3)) addAlias(d, n, 'agent', nycHpd.id, agents.filter((c) => c.corporationName === n).length);
        const people = new Set<string>();
        for (const c of contacts) {
          if (!c.person) continue;
          people.add(c.person);
          addPerson(d, { name: c.person, title: c.type === 'Agent' ? 'Managing Agent (HPD)' : c.type === 'HeadOfficer' ? 'Head Officer (HPD)' : c.type, role: roleCategoryFor(c.title, c.type), decisionMaker: ['HeadOfficer', 'IndividualOwner', 'Officer', 'Agent'].includes(c.type), org: c.corporationName, address: c.businessAddress }, nycHpd.id);
        }
        const regIds = [...new Set(contacts.map((c) => c.registrationId))];
        const added = await expandRegistrations(d, regIds, ctx, 120);
        note(d, `Cross-reference: ${contacts.length} NYC HPD contacts use the address ${addr.text}${agentNames.length ? ` (agent: ${agentNames.slice(0, 2).join(', ')})` : ''}; ${people.size} people named, +${added} NYC buildings.`);
        return `+${added} buildings, ${people.size} people, ${owners.length} owner rows`;
      });
    }
    add(`hud-addr:${akey}`, `HUD management contacts at ${addr.text}`, async () => {
      const records = await fetchHudByMgmtStreet(parts.street, ctx);
      const matching = records.filter((r) => !parts.zip || (r.mailingKey ?? '').endsWith(parts.zip));
      if (!matching.length) return 'no match';
      const added = ingestAll(d, matching, ctx);
      const orgs = [...new Set(matching.map((r) => r.managerName).filter(Boolean))];
      note(d, `Cross-reference: HUD management agent${orgs.length > 1 ? 's' : ''} ${orgs.slice(0, 2).join(', ')} use${orgs.length > 1 ? '' : 's'} ${addr.text} (+${added} buildings with contacts).`);
      return `+${added} buildings`;
    });
    add(`dos-addr:${akey}`, `NY entities with process address ${addr.text}`, async () => {
      const hits = await searchDosByAddress(parts.street, parts.zip, ctx, 25);
      if (!hits.length) return 'no match';
      touchSource(d, nyDos.id, nyDos.name, hits[0].url);
      const orgNames = hits.map((h) => h.processName).filter((n): n is string => !!n && !looksLikePerson(n) && !isLawOrAgentName(n));
      const counts = new Map<string, number>();
      for (const n of orgNames) counts.set(n, (counts.get(n) ?? 0) + 1);
      for (const [n, c] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) addAlias(d, n, 'process', nyDos.id, c);
      for (const h of hits.slice(0, 10)) if (h.processName && looksLikePerson(h.processName)) addPerson(d, { name: h.processName, title: 'Service of process (NY DOS)', role: 'owner', decisionMaker: true, address: h.processAddress }, nyDos.id);
      note(d, `Cross-reference: ${hits.length} NY-registered entities list ${addr.text} as their address${counts.size ? ` (most often ${[...counts.keys()][0]})` : ''}.`);
      return `${hits.length} entities`;
    });
    add(`opa-addr:${akey}`, `Philadelphia parcels mailed to ${addr.text}`, async () => {
      const { records, url } = await fetchOpaByMailing(parts.street, parts.zip, ctx);
      if (!records.length) return 'no match';
      touchSource(d, phlOpa.id, phlOpa.name, url);
      const added = ingestAll(d, records, ctx);
      note(d, `Cross-reference: ${records.length} Philadelphia apartment parcels are mailed to ${addr.text}, owners include ${[...new Set(records.map((r) => r.ownerName).filter(Boolean))].slice(0, 2).join(', ')} (+${added}).`);
      return `+${added} buildings`;
    });
    add(`montco-addr:${akey}`, `Montgomery County PA parcels mailed to ${addr.text}`, async () => {
      const { records, url } = await fetchMontcoByMailing(parts.street, ctx);
      const matching = records.filter((r) => !parts.zip || (r.mailingKey ?? '').endsWith(parts.zip));
      if (!matching.length) return 'no match';
      touchSource(d, montcoParcels.id, montcoParcels.name, url);
      const added = ingestAll(d, matching, ctx);
      note(d, `Cross-reference: ${matching.length} Montgomery County PA apartment parcels are mailed to ${addr.text}, owners include ${[...new Set(matching.map((r) => r.ownerName).filter(Boolean))].slice(0, 2).join(', ')} (+${added}).`);
      return `+${added} buildings`;
    });
    add(`nj-addr:${akey}`, `NJ apartment parcels mailed to ${addr.text}`, async () => {
      const { records, url } = await fetchNjParcelsByMailing(parts.street, ctx);
      const matching = records.filter((r) => !parts.zip || (r.mailingKey ?? '').endsWith(parts.zip));
      if (!matching.length) return 'no match';
      touchSource(d, njModiv.id, njModiv.name, url);
      const added = ingestAll(d, matching, ctx);
      note(d, `Cross-reference: ${matching.length} NJ apartment parcels send tax bills to ${addr.text} (+${added}).`);
      return `+${added} buildings`;
    });
  }

  // 4. People: every other building / LLC registered to the top decision makers.
  for (const p of rankPeople(d.people).filter((x) => x.decisionMaker && x.src.includes(nycHpd.id) && !isRoleName(x.name)).slice(0, 2)) {
    const np = splitName(p.name);
    if (!np.first || !np.last) continue;
    const zip = zip5(p.address?.match(/\b(\d{5})\b/)?.[1] ?? null);
    add(`hpd-person:${np.first.toUpperCase()}|${np.last.toUpperCase()}|${zip ?? ''}`, `Other NYC registrations for ${p.name}`, async () => {
      const { contacts, url } = await searchContactsByPerson(np.first!, np.last!, ctx, zip, 400);
      if (!contacts.length) return 'no match';
      touchSource(d, nycHpd.id, nycHpd.name, url);
      for (const c of contacts) if (c.corporationName && c.type === 'CorporateOwner') addAlias(d, c.corporationName, 'owner', nycHpd.id);
      const added = await expandRegistrations(d, contacts.map((c) => c.registrationId), ctx, 120);
      note(d, `Cross-reference: ${p.name} appears on ${new Set(contacts.map((c) => c.registrationId)).size} NYC registrations (+${added} buildings).`);
      return `+${added} buildings`;
    });
  }

  // 5. Registries for larger portfolios (website / HQ / public-company facts).
  const stats = portfolioStats(d);
  const best = topNames(d, 1)[0];
  if (best && (stats.units >= 400 || stats.buildings >= 8)) {
    add(`registry:${best.key}`, `Registries (GLEIF, Wikidata, SEC) for ${best.name}`, async () => {
      const results = await Promise.allSettled([lookupWikidata(best.name, ctx), lookupSec(best.name, ctx), lookupGleif(best.name, ctx)]);
      const found: string[] = [];
      for (const r of results) {
        if (r.status !== 'fulfilled' || !r.value) continue;
        const m = r.value;
        const src = m.source;
        const info = src === wikidata.id ? wikidata : src === secEdgar.id ? secEdgar : gleif;
        touchSource(d, src, info.name, m.url);
        addAlias(d, m.name, 'registry', src);
        if (m.website) addDomain(d, m.website, src, false);
        if (m.address) addAddress(d, m.address, 'hq', src);
        if (m.phone) addPhone(d, cleanPhone(m.phone), 'headquarters', src);
        if (m.isReit) addFact(d, { field: 'company_type', value: 'REIT', src, url: m.url, method: 'api', confidence: 0.95 });
        found.push(info.name);
      }
      if (found.length) note(d, `Registries: ${best.name} confirmed in ${found.join(', ')}.`);
      return found.length ? found.join(', ') : 'no match';
    });
  }

  // 6. User-configured connectors (Settings > Connectors).
  for (const c of ctx.connectors ?? []) {
    if (c.role !== 'people' && c.role !== 'company') continue;
    const input = c.inputKey(d);
    if (!input) continue;
    add(`conn:${c.id}:${input}`, `${c.name}`, async () => {
      const outcome = await runEnrichmentConnectors(d, c, ctx);
      if (outcome !== 'no match') note(d, `${c.name}: ${outcome}.`);
      return outcome;
    });
  }

  // 7. Web presence: search API, ContactOut, domain discovery, website crawl.
  if (best && searchProvider()) {
    const city = d.buildings[0]?.city ?? '';
    add(`search:${best.key}`, `Web search for ${best.name}`, async () => {
      const hits = await search(`"${best.name}" ${city} property management apartments`, ctx, 8);
      touchSource(d, webSearch.id, webSearch.name);
      let learned = 0;
      for (const h of hits) {
        if (isContactOutCompanyUrl(h.url) && !d.links.contactout) { d.links.contactout = h.url; learned += 1; continue; }
        if (/linkedin\.com\/company\//i.test(h.url) && !d.linkedin) { d.linkedin = h.url.split('?')[0]; learned += 1; continue; }
        const domain = domainOfUrl(h.url);
        if (domain && addDomain(d, domain, webSearch.id)) learned += 1;
      }
      return learned ? `${learned} leads` : 'no match';
    });
    if (!d.links.contactout) {
      add(`contactout-find:${best.key}`, `Find ${best.name} on ContactOut`, async () => {
        const url = await findContactOutUrl(best.name, ctx);
        if (!url) return 'no match';
        d.links.contactout = url;
        return 'found profile';
      });
    }
  }
  if (d.links.contactout) {
    const url = d.links.contactout;
    add(`contactout:${url}`, 'ContactOut company profile', async () => {
      const co = await fetchContactOutCompany(url, ctx);
      touchSource(d, contactOut.id, contactOut.name, url);
      if (co.name) addAlias(d, co.name, 'website', contactOut.id);
      if (co.phone) addPhone(d, co.phone, 'main office (ContactOut)', contactOut.id);
      if (co.location) addAddress(d, co.location, 'hq', contactOut.id);
      if (co.website) addDomain(d, co.website, contactOut.id);
      if (co.linkedin && !d.linkedin) d.linkedin = co.linkedin;
      for (const e of co.employees) {
        addPerson(d, { name: e.name, title: e.title, role: roleCategoryFor(e.title), decisionMaker: isDecisionMakerTitle(e.title) }, contactOut.id);
      }
      for (const pe of co.publishedEmails) {
        if (pe.person) addPerson(d, { name: pe.person, email: pe.email, emailStatus: 'published' }, contactOut.id);
        else addEmail(d, pe.email, 'published', contactOut.id, 0.85);
      }
      if (co.emailFormat) {
        addDomain(d, co.emailFormat.domain, contactOut.id, true);
        addFact(d, { field: 'email_format', value: `${co.emailFormat.pattern}@${co.emailFormat.domain}${co.emailFormat.pct ? ` (${co.emailFormat.pct}% of staff)` : ''}`, src: contactOut.id, url, method: 'scrape', confidence: 0.85 });
      }
      note(d, `ContactOut: ${co.employees.length} staff with titles${co.emailFormat ? `, email format ${co.emailFormat.raw}@${co.emailFormat.domain}${co.emailFormat.pct ? ` (${co.emailFormat.pct}%)` : ''}` : ''}${co.publishedEmails.length ? `, ${co.publishedEmails.length} published email(s)` : ''}.`);
      return `${co.employees.length} staff`;
    });
  }

  // Verify domains we learned from emails/registries/search (homepage must name the company).
  const name = best?.name ?? d.name;
  for (const dom of d.domains.filter((x) => !x.verified).slice(0, 3)) {
    add(`verify:${dom.domain}`, `Check website ${dom.domain}`, async () => {
      const probe = await probeDomain(dom.domain, name, ctx);
      const fromEmail = d.emails.some((e) => e.email.endsWith(`@${dom.domain}`) && e.status === 'published');
      if (probe && (probe.score >= 0.55 || (fromEmail && probe.score >= 0.3))) {
        dom.verified = true;
        d.website = probe.facts.url;
        touchSource(d, WEBSITE_SOURCE.id, WEBSITE_SOURCE.name, probe.facts.url);
        if (probe.facts.siteName && probe.score >= 0.6) addAlias(d, probe.facts.siteName, 'website', WEBSITE_SOURCE.id);
        note(d, `Website confirmed: ${dom.domain}${fromEmail ? ' (matches the published email domain)' : ''}.`);
        return 'verified';
      }
      return probe ? `name match ${probe.score.toFixed(2)}` : 'unreachable';
    });
  }
  if (!d.domains.some((x) => x.verified) && best && best.kind !== 'principal' && !isSingleAssetName(best.name)) {
    add(`guess:${best.key}`, `Find website for ${best.name}`, async () => {
      const tried = new Set(d.domains.map((x) => x.domain));
      const hit = await guessDomain(best.name, ctx, tried);
      if (!hit) return 'not found';
      addDomain(d, hit.domain, WEBSITE_SOURCE.id, true);
      d.website = hit.facts.url;
      touchSource(d, WEBSITE_SOURCE.id, WEBSITE_SOURCE.name, hit.facts.url);
      note(d, `Website found by name: ${hit.domain} (homepage names ${best.name}).`);
      return hit.domain;
    });
  }
  const verified = d.domains.find((x) => x.verified);
  if (verified) {
    add(`site:${verified.domain}`, `Crawl ${verified.domain}`, async () => {
      const crawl = await crawlSite(verified.domain, ctx, 5);
      touchSource(d, WEBSITE_SOURCE.id, WEBSITE_SOURCE.name, crawl.homepage);
      let people = 0;
      let emails = 0;
      for (const page of crawl.pages) {
        for (const p of page.people) {
          if (addPerson(d, { name: p.name, title: p.title, role: roleCategoryFor(p.title), decisionMaker: isDecisionMakerTitle(p.title), email: p.email, emailStatus: 'published', phone: p.phone, linkedin: p.linkedin }, WEBSITE_SOURCE.id).isNew) people += 1;
        }
        for (const e of page.emails) {
          const onDomain = e.endsWith(`@${verified.domain}`);
          if (addEmail(d, e, 'published', WEBSITE_SOURCE.id, onDomain ? 0.9 : 0.6)) emails += 1;
        }
        page.phones.slice(0, 2).forEach((ph, i) => addPhone(d, ph, i === 0 ? 'main office (website)' : 'website', WEBSITE_SOURCE.id));
        for (const a of page.addresses.slice(0, 2)) addAddress(d, a, 'website', WEBSITE_SOURCE.id);
        for (const claim of page.portfolio) d.portfolioClaims.push({ ...claim, src: WEBSITE_SOURCE.id });
        if (page.linkedin && !d.linkedin) d.linkedin = page.linkedin;
        const co = page.links.find((l) => isContactOutCompanyUrl(l));
        if (co && !d.links.contactout) d.links.contactout = co;
      }
      // Attach published emails to people when the local part matches their name.
      for (const e of d.emails) {
        if (e.personKey) continue;
        for (const p of d.people) {
          const parts = nameParts(p.name);
          if (!parts) continue;
          const local = e.email.split('@')[0];
          if (local.includes(parts.last) && (local.includes(parts.first) || local.startsWith(parts.first[0]))) {
            e.personKey = p.key;
            if (!p.emails.some((x) => x.email === e.email)) p.emails.push({ ...e, personKey: p.key });
          }
        }
      }
      note(d, `Website ${verified.domain}: crawled ${crawl.pages.length} page(s), ${people} new people, ${emails} emails${d.portfolioClaims.length ? `, portfolio claim ${JSON.stringify(d.portfolioClaims[d.portfolioClaims.length - 1]).replace(/[{}"]/g, '')}` : ''}.`);
      return `${crawl.pages.length} pages, ${people} people, ${emails} emails`;
    });
  }

  // 8. Email inference for decision makers without an address.
  const domain = primaryDomain(d);
  const needEmail = rankPeople(d.people).filter((p) => (p.decisionMaker || p.role === 'property_manager') && !p.emails.length && !isRoleName(p.name) && nameParts(p.name)).slice(0, 6);
  if (domain && needEmail.length) {
    add(`infer:${domain}:${needEmail.map((p) => p.key).join(',')}`, `Infer emails at ${domain}`, async () => {
      const pairs = d.people.flatMap((p) => p.emails.filter((e) => e.status === 'published').map((e) => ({ name: p.name, email: e.email })));
      let learned = learnPattern(pairs, domain);
      const formatFact = d.facts.find((f) => f.field === 'email_format' && f.value.includes(`@${domain}`));
      if (formatFact) {
        const pattern = formatFact.value.split('@')[0] as Pattern;
        learned = { pattern, support: Math.max(learned?.support ?? 0, 2) };
      }
      if (!(await hasMx(domain, ctx))) return 'domain has no mail server';
      let count = 0;
      for (const p of needEmail) {
        const guess = inferEmail(p.name, domain, learned);
        if (!guess || isRoleAddress(guess.email)) continue;
        addPerson(d, { name: p.name, email: guess.email, emailStatus: 'inferred' }, 'email-pattern');
        const stored = d.emails.find((e) => e.email === guess.email);
        if (stored) stored.confidence = guess.confidence;
        addFact(d, { field: `email:${p.name}`, value: `${guess.email} — ${guess.basis}`, src: 'email-pattern', method: 'inferred', confidence: guess.confidence });
        count += 1;
      }
      touchSource(d, 'email-pattern', 'Email pattern inference');
      note(d, `Inferred ${count} decision-maker email${count === 1 ? '' : 's'} at ${domain} (${learned ? `format ${learned.pattern}@ from published examples` : 'common first.last@ format, unconfirmed'}).`);
      return `${count} inferred`;
    });
  }

  // 9. Buildings: coordinates -> utility, reported water use, payment signals.
  const njMissing = d.buildings.filter((b) => b.state === 'NJ' && b.parcelId && b.lat === null).sort((a, b) => (b.units ?? 0) - (a.units ?? 0)).slice(0, 40);
  if (njMissing.length) {
    add(`nj-centroids:${njMissing.length}:${njMissing[0].key}`, 'Locate NJ parcels', async () => {
      const map = await fetchNjCentroids(njMissing.map((b) => b.parcelId!), ctx);
      for (const b of njMissing) {
        const c = map.get(b.parcelId!);
        if (c) { b.lat = c.lat; b.lon = c.lon; }
      }
      return `${map.size} located`;
    });
  }
  const noCoords = d.buildings.filter((b) => b.lat === null && b.state !== 'NJ').sort((a, b) => (b.units ?? 0) - (a.units ?? 0)).slice(0, 6);
  if (noCoords.length) {
    add(`geocode:${noCoords.map((b) => b.key).join(',')}`, 'Geocode buildings', async () => {
      let n = 0;
      for (const b of noCoords) {
        if (Date.now() > ctx.deadline - 2000) break;
        try {
          const g = await geocodeAddress(`${b.address}, ${b.city ?? ''}, ${b.state} ${b.zip ?? ''}`, ctx);
          if (g) { b.lat = g.lat; b.lon = g.lon; n += 1; }
        } catch (e) {
          if (e instanceof SourceError && e.code === 'disabled') break;
        }
      }
      if (n) touchSource(d, censusGeocoder.id, censusGeocoder.name);
      return `${n} geocoded`;
    });
  }
  const needUtility = d.buildings.filter((b) => b.lat !== null && b.lon !== null && !b.utilityPwsid).sort((a, b) => (b.units ?? 0) - (a.units ?? 0));
  if (needUtility.length) {
    add(`utility:${needUtility.length}:${needUtility[0].key}`, 'Water utility per building (EPA)', async () => {
      const cells = new Map<string, typeof needUtility>();
      for (const b of needUtility) {
        const cell = `${b.lat!.toFixed(2)},${b.lon!.toFixed(2)}`;
        const list = cells.get(cell);
        if (list) list.push(b);
        else cells.set(cell, [b]);
      }
      let resolved = 0;
      for (const [, list] of [...cells.entries()].slice(0, 15)) {
        if (Date.now() > ctx.deadline - 2000) break;
        const sys = await waterSystemAt(list[0].lat!, list[0].lon!, ctx);
        if (!sys) continue;
        for (const b of list) { b.utilityName = sys.name; b.utilityPwsid = sys.pwsid; resolved += 1; }
      }
      touchSource(d, epaWater.id, epaWater.name);
      estimateWater(d);
      if (d.water.utilities.length) note(d, `Water utility: ${d.water.utilities.map((u) => `${u.name} (${u.buildings} bldg, ${u.meter.label})`).slice(0, 3).join('; ')}.`);
      return `${resolved} buildings`;
    });
  }
  const bbls = d.buildings.filter((b) => b.bbl && b.reportedWaterKgal === null).map((b) => b.bbl!).slice(0, 160);
  if (bbls.length) {
    add(`ll84:${bbls.length}:${bbls[0]}`, 'NYC reported water use (LL84)', async () => {
      const map = await fetchLl84ByBbl(bbls, ctx);
      let n = 0;
      for (const b of d.buildings) {
        const rec = b.bbl ? map.get(b.bbl) : undefined;
        if (rec?.waterKgal) { b.reportedWaterKgal = rec.waterKgal; b.reportedWaterYear = rec.reportYear; n += 1; }
      }
      if (n) {
        touchSource(d, nycLl84.id, nycLl84.name);
        estimateWater(d);
        note(d, `NYC LL84: reported water use for ${n} building${n === 1 ? '' : 's'} (${Math.round(d.water.reportedKgal ?? 0).toLocaleString()} kgal/yr).`);
      }
      return `${n} with water data`;
    });
    add(`liens:${bbls.length}:${bbls[0]}`, 'NYC lien sale list (water & tax debt)', async () => {
      const map = await fetchLiensByBbl(bbls, ctx);
      let water = 0;
      for (const b of d.buildings) {
        const lien = b.bbl ? map.get(b.bbl) : undefined;
        if (!lien) continue;
        d.signals.push({ kind: lien.waterDebtOnly ? 'water_lien' : 'tax_lien', severity: lien.waterDebtOnly ? 'high' : 'medium', detail: `${b.address}: on the ${lien.month ?? ''} NYC lien sale list${lien.waterDebtOnly ? ' for unpaid water/sewer charges' : ' (tax and/or water debt)'}`, building: b.key, src: nycLiens.id });
        if (lien.waterDebtOnly) water += 1;
      }
      if (map.size) {
        touchSource(d, nycLiens.id, nycLiens.name);
        note(d, `Payment signal: ${map.size} building${map.size === 1 ? '' : 's'} on NYC lien sale lists${water ? `, ${water} for water debt only` : ''}.`);
      }
      return map.size ? `${map.size} liens` : 'none';
    });
  }

  return tasks;
}

/** HUD distress indicators already on the HUD building records -> signals. */
function hudSignals(d: Dossier, records: PropertyRecord[]) {
  for (const r of records) {
    const h = hudHealth(r.extra as Record<string, unknown> | undefined);
    if (!h) continue;
    if (h.troubled && /troubled|potentially/i.test(h.troubled)) d.signals.push({ kind: 'hud_troubled', severity: 'medium', detail: `${r.address}: HUD status "${h.troubled}"`, building: r.sourceKey, src: hudAssisted.id });
    const reac = reacNumber(h.reacScore);
    if (reac !== null && reac < 60) d.signals.push({ kind: 'reac_fail', severity: 'medium', detail: `${r.address}: failed HUD REAC inspection (${h.reacScore})`, building: r.sourceKey, src: hudAssisted.id });
    if (h.dscr !== null && h.dscr > 0 && h.dscr < 1) d.signals.push({ kind: 'low_dscr', severity: 'info', detail: `${r.address}: debt service coverage ${h.dscr.toFixed(2)} (below 1.0)`, building: r.sourceKey, src: hudAssisted.id });
    if (h.defaultDelinquent) d.signals.push({ kind: 'default', severity: 'high', detail: `${r.address}: HUD flags default/delinquency`, building: r.sourceKey, src: hudAssisted.id });
  }
}
export { hudSignals };

/** Recomputes derived fields after every step. */
export function derive(d: Dossier) {
  chooseName(d);
  estimateWater(d);
  d.gaps = computeGaps(d);
  // Keep the people list readable: drop role placeholders when real names exist.
  if (d.people.length > 1) d.people = d.people.filter((p) => !(isRoleName(p.name) && p.emails.length === 0 && p.phones.length === 0));
  if (d.people.length > 150) d.people = rankPeople(d.people).slice(0, 150);
  for (const p of d.people) if (p.name === p.name.toUpperCase()) p.name = displayPersonName(null, null, p.name);
  d.signals = d.signals.filter((s, i, all) => all.findIndex((x) => x.detail === s.detail) === i).slice(0, 40);
}

/**
 * Runs cross-reference tasks on a dossier until nothing new is learned, the per-prospect
 * budget is spent, or the deadline is near. Returns true when the dossier is complete.
 */
export async function resolveDossier(d: Dossier, ctx: ResolveCtx, maxRuns = 40): Promise<boolean> {
  d.status = 'enriching';
  derive(d);
  while (d.runs < maxRuns) {
    if (Date.now() > ctx.deadline - 2500) return false;
    const tasks = planTasks(d, ctx);
    if (!tasks.length) break;
    const task = tasks[0];
    d.runs += 1;
    try {
      const outcome = await task.run();
      d.done[task.key] = outcome;
      ctx.log?.(outcome.startsWith('+') || /\d+ (inferred|staff|people|entities|liens)|verified|found/.test(outcome) ? 'success' : 'info', `${d.name}: ${task.label} → ${outcome}`);
    } catch (error) {
      if (error instanceof SourceError && error.code === 'budget') return false;
      d.done[task.key] = `error: ${describeError(error).slice(0, 120)}`;
      ctx.log?.('warn', `${d.name}: ${task.label} failed (${describeError(error).slice(0, 100)})`);
    }
    derive(d);
  }
  d.status = 'done';
  derive(d);
  return true;
}

/** Lookup links shown next to each person (spend your own ContactOut searches on the best leads). */
export function personLookupLinks(person: string, company: string | null) {
  return { contactout: contactOutLookupUrl(person, company) };
}

export { normalizeDomain, titleCase };
