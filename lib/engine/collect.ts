/**
 * Discovery collection: turns a search (states, counties/cities/ZIPs, size filters) into a list
 * of paged source pulls, and executes them a slice at a time. Raw building records are staged in
 * research_job_records; aggregated NYC seeds (top managing agents / head officers) are staged too.
 */
import type { LoadedConnector } from './connectors';
import { runBuildingConnector } from './connectors';
import type { FetchCtx } from './sources/common';
import { fetchHudProperties } from './sources/hud-multifamily';
import { fetchPhaDevelopments } from './sources/hud-public-housing';
import { fetchNjParcels, NJ_COUNTIES, njCountiesFor } from './sources/nj-modiv';
import { fetchTopAgents, fetchTopHeadOfficers } from './sources/nyc-hpd';
import { fetchPlutoLots, isNycZip, nycBoroughsFor } from './sources/nyc-pluto';
import { fetchOpaParcels } from './sources/phl-opa';
import { fetchMontcoParcels } from './sources/pa-counties';
import type { DiscoverInput, PropertyRecord } from './types';

export type CollectTask = {
  id: string;
  label: string;
  kind: 'nj' | 'opa' | 'montco' | 'hud-assisted' | 'hud-insured' | 'pha' | 'pluto' | 'hpd-agents' | 'hpd-officers' | 'connector';
  params: Record<string, unknown>;
  offset: number;
  pageSize: number;
  maxRows: number;
  fetched: number;
  done: boolean;
  error?: string;
};

export type StagedSeed = { seed: { kind: 'hpd-agent' | 'hpd-officer'; label: string; count: number; first?: string; last?: string; house?: string; street?: string; zip?: string; url: string } };

const NYC_COUNTIES = /^(new york|kings|queens|bronx|richmond|manhattan|brooklyn|staten island|nyc|new york city|the bronx)( county)?$/i;
const PHILLY = /^(philadelphia|phila)( county)?$/i;

export function normalizeInput(input: Partial<DiscoverInput>): DiscoverInput {
  const states = (input.states?.length ? input.states : ['NJ', 'NY', 'PA']).map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s));
  return {
    states: [...new Set(states)],
    counties: (input.counties ?? []).map((c) => c.trim()).filter(Boolean),
    cities: (input.cities ?? []).map((c) => c.trim()).filter(Boolean),
    zips: (input.zips ?? []).map((z) => z.trim().slice(0, 5)).filter((z) => /^\d{5}$/.test(z)),
    minUnits: input.minUnits ?? 50,
    maxUnits: input.maxUnits,
    minBuildings: input.minBuildings ?? 1,
    maxBuildings: input.maxBuildings,
    minBuildingUnits: input.minBuildingUnits ?? 10,
    ownerType: input.ownerType ?? 'any',
    keywords: input.keywords ?? [],
    limit: Math.min(200, Math.max(5, input.limit ?? 40)),
  };
}

/** Builds the collection plan for a discovery search. */
export function planCollection(input: DiscoverInput, connectors: LoadedConnector[] = []): CollectTask[] {
  const tasks: CollectTask[] = [];
  const counties = input.counties ?? [];
  const cities = input.cities ?? [];
  const zips = input.zips ?? [];
  const minB = input.minBuildingUnits ?? 10;
  const push = (t: Omit<CollectTask, 'offset' | 'fetched' | 'done'>) => tasks.push({ ...t, offset: 0, fetched: 0, done: false });
  const geoGiven = counties.length + cities.length + zips.length > 0;

  if (input.states.includes('NJ')) {
    let njCounties = njCountiesFor(counties);
    if (!njCounties.length && !geoGiven) njCounties = NJ_COUNTIES;
    if (!njCounties.length && geoGiven && zips.some((z) => z.startsWith('07') || z.startsWith('08'))) njCounties = NJ_COUNTIES;
    for (const county of njCounties) {
      push({ id: `nj:${county}`, label: `NJ apartment parcels · ${county.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())} County`, kind: 'nj', params: { county }, pageSize: 1000, maxRows: 6000 });
    }
  }

  if (input.states.includes('NY')) {
    const boroughs = nycBoroughsFor([...counties, ...cities]);
    const nycZips = zips.filter(isNycZip);
    const nycInScope = !geoGiven || boroughs.length > 0 || nycZips.length > 0 || counties.some((c) => NYC_COUNTIES.test(c)) || cities.some((c) => NYC_COUNTIES.test(c));
    if (nycInScope) {
      push({ id: 'pluto', label: `NYC residential lots (PLUTO)${boroughs.length ? ` · ${boroughs.join(', ')}` : ''}`, kind: 'pluto', params: { boroughs, zips: nycZips, minUnits: Math.max(minB, 20) }, pageSize: 4000, maxRows: 12000 });
      push({ id: 'hpd-agents', label: 'NYC managing agents (HPD, citywide)', kind: 'hpd-agents', params: { limit: 150 }, pageSize: 150, maxRows: 150 });
      push({ id: 'hpd-officers', label: 'NYC owners / head officers (HPD, citywide)', kind: 'hpd-officers', params: { limit: 150 }, pageSize: 150, maxRows: 150 });
    }
  }

  if (input.states.includes('PA')) {
    const phillyZips = zips.filter((z) => z.startsWith('191'));
    const phillyInScope = !geoGiven || phillyZips.length > 0 || counties.some((c) => PHILLY.test(c)) || cities.some((c) => PHILLY.test(c));
    if (phillyInScope) {
      push({ id: 'opa', label: 'Philadelphia apartment parcels (OPA)', kind: 'opa', params: { zips: phillyZips, minBand: minB >= 51 ? 51 : 5 }, pageSize: 2000, maxRows: 12000 });
    }
    const montcoInScope = !geoGiven || counties.some((c) => /^montgomery/i.test(c)) || zips.some((z) => /^19(0[0-4]|4[0-9])/.test(z));
    if (montcoInScope) {
      push({ id: 'montco', label: 'Montgomery County PA apartment parcels', kind: 'montco', params: { minUnits: Math.max(minB, 5) }, pageSize: 2000, maxRows: 6000 });
    }
  }

  const hudGeo = { states: input.states, counties, cities, zips, minUnits: Math.max(minB, 20) };
  push({ id: 'hud-assisted', label: 'HUD assisted multifamily (with management contacts)', kind: 'hud-assisted', params: hudGeo, pageSize: 2000, maxRows: 8000 });
  push({ id: 'hud-insured', label: 'HUD FHA-insured multifamily', kind: 'hud-insured', params: hudGeo, pageSize: 2000, maxRows: 8000 });
  if (input.ownerType === 'any' || input.ownerType === 'public_housing') {
    push({ id: 'pha', label: 'Public housing authorities (HUD)', kind: 'pha', params: hudGeo, pageSize: 2000, maxRows: 4000 });
  }

  for (const c of connectors.filter((x) => x.role === 'buildings')) {
    const covered = c.config.states?.length ? input.states.filter((s) => c.config.states!.includes(s)) : [c.config.state ?? input.states[0]];
    for (const state of covered) {
      push({ id: `conn:${c.id}:${state}`, label: `${c.name} (${state})`, kind: 'connector', params: { connectorId: c.id, state, minUnits: minB }, pageSize: Math.min(2000, c.config.maxRows ?? 2000), maxRows: c.config.maxRows ?? 5000 });
    }
  }
  return tasks;
}

export type CollectPage = { records: PropertyRecord[]; seeds: StagedSeed[]; raw: number; done: boolean };

/** Fetches the next page of one collection task. */
export async function collectPage(task: CollectTask, input: DiscoverInput, ctx: FetchCtx, connectors: LoadedConnector[]): Promise<CollectPage> {
  const page = { offset: task.offset, limit: Math.min(task.pageSize, task.maxRows - task.fetched) };
  const p = task.params as Record<string, never>;
  const minB = input.minBuildingUnits ?? 10;
  const keep = (records: PropertyRecord[]) => records.filter((r) => r.units === null || r.units === undefined || r.units >= minB);
  const finish = (raw: number, exceeded = true) => raw < page.limit || !exceeded || task.fetched + raw >= task.maxRows;

  switch (task.kind) {
    case 'nj': {
      const r = await fetchNjParcels({ county: p.county }, page, ctx);
      return { records: keep(r.records), seeds: [], raw: r.raw, done: finish(r.raw, r.exceeded || r.raw === page.limit) };
    }
    case 'opa': {
      const r = await fetchOpaParcels({ zips: p.zips, minBand: p.minBand }, page, ctx);
      return { records: keep(r.records), seeds: [], raw: r.raw, done: finish(r.raw, r.exceeded || r.raw === page.limit) };
    }
    case 'montco': {
      const r = await fetchMontcoParcels(p.minUnits ?? minB, page, ctx);
      return { records: keep(r.records), seeds: [], raw: r.raw, done: finish(r.raw, r.exceeded || r.raw === page.limit) };
    }
    case 'hud-assisted':
    case 'hud-insured': {
      const r = await fetchHudProperties(task.kind === 'hud-assisted' ? 'hud-mf-assisted' : 'hud-mf-insured', task.params as unknown as Parameters<typeof fetchHudProperties>[1], page, ctx);
      return { records: keep(r.records), seeds: [], raw: r.raw, done: finish(r.raw, r.exceeded || r.raw === page.limit) };
    }
    case 'pha': {
      const r = await fetchPhaDevelopments(task.params as unknown as Parameters<typeof fetchPhaDevelopments>[0], page, ctx);
      return { records: keep(r.records), seeds: [], raw: r.raw, done: finish(r.raw, r.exceeded || r.raw === page.limit) };
    }
    case 'pluto': {
      const r = await fetchPlutoLots({ boroughs: p.boroughs, zips: p.zips, minUnits: p.minUnits }, page, ctx);
      return { records: r.records, seeds: [], raw: r.raw, done: r.raw < page.limit || task.fetched + r.raw >= task.maxRows };
    }
    case 'hpd-agents': {
      const seeds = await fetchTopAgents(p.limit ?? 150, ctx);
      return { records: [], seeds: seeds.map((s) => ({ seed: { kind: 'hpd-agent', label: s.label, count: s.count, url: s.url } })), raw: seeds.length, done: true };
    }
    case 'hpd-officers': {
      const seeds = await fetchTopHeadOfficers(p.limit ?? 150, ctx);
      return { records: [], seeds: seeds.map((s) => ({ seed: { kind: 'hpd-officer', label: s.label, count: s.count, first: s.first, last: s.last, house: s.house, street: s.street, zip: s.zip, url: s.url } })), raw: seeds.length, done: true };
    }
    case 'connector': {
      const c = connectors.find((x) => x.id === p.connectorId);
      if (!c) return { records: [], seeds: [], raw: 0, done: true };
      const r = await runBuildingConnector(c, { state: p.state, minUnits: p.minUnits }, page, ctx);
      return { records: keep(r.records), seeds: [], raw: r.raw, done: r.raw < page.limit || task.fetched + r.raw >= task.maxRows };
    }
  }
}

/** Does a dossier have at least one building in the requested geography? */
export function inGeography(b: { state: string; county: string | null; city: string | null; zip: string | null }, input: DiscoverInput): boolean {
  if (!input.states.includes(b.state)) return false;
  const counties = (input.counties ?? []).map((c) => c.toLowerCase().replace(/\s*county$/, ''));
  const cities = (input.cities ?? []).map((c) => c.toLowerCase());
  const zips = input.zips ?? [];
  if (!counties.length && !cities.length && !zips.length) return true;
  const county = (b.county ?? '').toLowerCase().replace(/\s*county$/, '');
  const city = (b.city ?? '').toLowerCase();
  const boroughAlias: Record<string, string[]> = { brooklyn: ['kings'], manhattan: ['new york'], 'staten island': ['richmond'], bronx: ['bronx'], queens: ['queens'] };
  if (counties.some((c) => county.startsWith(c) || (boroughAlias[c] ?? []).includes(county) || city === c)) return true;
  if (cities.some((c) => city.startsWith(c) || (boroughAlias[c] ?? []).includes(county))) return true;
  if (b.zip && zips.includes(b.zip)) return true;
  return false;
}
