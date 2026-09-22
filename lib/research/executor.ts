import { bestClaim } from './graph';
import { ingestCompanyWebsite, ingestHpdOwnership, ingestNjParcel } from './ingest';
import { ingestWaterServiceAreas } from './ingest-water';
import type { ResearchGraph, ResearchTask } from './types';
import { executeWebDiscovery } from './web-discovery';
import { executeBrowserDirectoryResearch } from './browser-research';
import { crawlCompanyWebsite } from './sources/company-website';
import { lookupHpdOwnershipByBbl } from './sources/nyc-hpd';
import { searchNjParcelsByAddress } from './sources/nj-parcels';
import { geocodeUsAddress, lookupEpaWaterSystems, lookupNjPurveyors, lookupPaWaterSuppliers } from './sources/water-service';
import { ingestUtilityWebsite, researchUtilityWebsite } from './sources/utility-website';
import { ingestSecCompanyResearch, researchSecCompany } from './sources/sec-edgar';
import { resolvePersonFromCompanySite } from './sources/person-company';
import { researchOfficialBusinessIdentity } from './sources/official-business';
import { ingestAcrisOwnership, lookupAcrisOwnershipByAddress } from './sources/nyc-acris';
import { ingestNycPluto, lookupNycPlutoByBbl } from './sources/nyc-pluto';
import { ingestPhiladelphiaOpa, lookupPhiladelphiaOpaByAddress } from './sources/philadelphia-opa';
import { ingestNysTaxParcel, lookupNysTaxParcelByAddress } from './sources/nys-tax-parcels';

export interface ResearchTaskResult {
  taskId: string;
  status: 'complete' | 'blocked' | 'failed';
  sourceId: string;
  discoveredEntityIds: string[];
  evidenceAdded: number;
  claimsAdded: number;
  message: string;
  retryable?: boolean;
}

export async function executeResearchTask(
  graph: ResearchGraph,
  task: ResearchTask,
  options: { searchEndpoint?: string; signal?: AbortSignal } = {},
): Promise<ResearchTaskResult> {
  const beforeEntities = new Set(graph.entities.map((item) => item.id));
  const beforeEvidence = graph.evidence.length;
  const beforeClaims = graph.claims.length;
  task.status = 'running';

  try {
    const message = await executeSource(graph, task, options);
    task.status = message.blocked ? 'blocked' : 'complete';
    return {
      taskId: task.id,
      status: message.blocked ? 'blocked' : 'complete',
      sourceId: task.sourceId,
      discoveredEntityIds: graph.entities.filter((item) => !beforeEntities.has(item.id)).map((item) => item.id),
      evidenceAdded: graph.evidence.length - beforeEvidence,
      claimsAdded: graph.claims.length - beforeClaims,
      message: message.text,
      retryable: message.retryable,
    };
  } catch (error) {
    task.status = 'failed';
    return {
      taskId: task.id,
      status: 'failed',
      sourceId: task.sourceId,
      discoveredEntityIds: graph.entities.filter((item) => !beforeEntities.has(item.id)).map((item) => item.id),
      evidenceAdded: graph.evidence.length - beforeEvidence,
      claimsAdded: graph.claims.length - beforeClaims,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function executeSource(
  graph: ResearchGraph,
  task: ResearchTask,
  options: { searchEndpoint?: string; signal?: AbortSignal },
): Promise<{ text: string; blocked?: boolean; retryable?: boolean }> {
  const entity = graph.entities.find((item) => item.id === task.subjectId);
  if (!entity) return { text: 'Research subject no longer exists.', blocked: true };

  if (task.sourceId === 'nys-dos-business' || task.sourceId === 'nj-dores-business' || task.sourceId === 'pa-dos-business') {
    if (entity.kind !== 'company') return { text: 'Official business-record research requires a company entity.', blocked: true };
    const result = await researchOfficialBusinessIdentity(graph, entity.id, task.sourceId, options.signal);
    return { text: result.message, blocked: result.matched === 0 };
  }

  if (task.sourceId === 'sec-edgar') {
    if (entity.kind !== 'company') return { text: 'SEC EDGAR research requires a company entity.', blocked: true };
    const research = await researchSecCompany(entity.label, options.signal);
    if (!research) return { text: 'No sufficiently strong SEC filer match was found.', blocked: true, retryable: false };
    ingestSecCompanyResearch(graph, entity.id, research);
    return { text: 'SEC EDGAR matched CIK ' + research.cik + ' and found ' + research.executives.length + ' executive signal(s).' };
  }

  if (task.sourceId === 'person-company-first-party') {
    if (entity.kind !== 'person') return { text: 'Named-person resolution requires a person entity.', blocked: true };
    try {
      const result = await resolvePersonFromCompanySite(graph, entity.id, options.signal);
      return { text: result.message, blocked: result.pages === 0 || (result.contacts === 0 && result.titles === 0) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), blocked: true, retryable: false };
    }
  }

  if (task.sourceId === 'contactout-public-directory') {
    if (entity.kind !== 'company') return { text: 'Contact directory enrichment requires a company entity.', blocked: true };
    try {
      const result = await executeBrowserDirectoryResearch(graph, task, { signal: options.signal });
      return { text: result.message };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), blocked: true, retryable: false };
    }
  }

  if (task.sourceId === 'open-web-discovery') {
    const response = await executeWebDiscovery(graph, task, { endpoint: options.searchEndpoint, signal: options.signal, limit: 10 });
    return { text: `Open-web discovery returned ${response.results.length} result(s).` };
  }

  if (task.sourceId === 'company-first-party-web') {
    if (entity.kind !== 'company') return { text: 'First-party company crawl requires a company entity.', blocked: true };
    let website = bestClaim(graph, entity.id, 'company.website');
    if (!stringValue(website?.value)) {
      try {
        await executeWebDiscovery(graph, { ...task, sourceId: 'open-web-discovery' }, { endpoint: options.searchEndpoint, signal: options.signal, limit: 8 });
      } catch (error) {
        return { text: `Company website is unresolved and web discovery could not run: ${error instanceof Error ? error.message : String(error)}`, blocked: true, retryable: true };
      }
      website = bestClaim(graph, entity.id, 'company.website');
    }
    const url = stringValue(website?.value);
    if (!url) return { text: 'No credible first-party website candidate is available yet.', blocked: true, retryable: true };
    const research = await crawlCompanyWebsite(url, { maxPages: 9, signal: options.signal });
    ingestCompanyWebsite(graph, entity.id, research);
    return { text: `Crawled ${research.visitedUrls.length} first-party page(s); found ${research.contacts.length} public business contact(s) and ${research.leadershipSignals.length} leadership signal(s).` };
  }

  if (task.sourceId === 'utility-first-party-web') {
    if (entity.kind !== 'utility') return { text: 'Utility first-party research requires a utility entity.', blocked: true };
    const research = await researchUtilityWebsite(entity.label, { maxPages: 8, signal: options.signal });
    if (!research.seedUrl) return { text: research.warnings[0] ?? 'No credible utility website was found.', blocked: true, retryable: true };
    ingestUtilityWebsite(graph, entity.id, research);
    return {
      text: `Crawled ${research.visitedUrls.length} utility page(s); found ${research.amiSignals.length} AMI/smart-meter program signal(s) and ${research.rateSignals.length} rate signal(s).`,
      blocked: research.amiSignals.length === 0 && research.rateSignals.length === 0,
      retryable: research.amiSignals.length === 0 && research.rateSignals.length === 0,
    };
  }

  if (task.sourceId === 'nj-parcel-mod4') {
    if (entity.kind !== 'property') return { text: 'NJ parcel resolution requires a property entity.', blocked: true };
    const records = await searchNjParcelsByAddress(entity.label, options.signal);
    if (records.length === 1) ingestNjParcel(graph, records[0], undefined, undefined, entity.id);
    return {
      text: records.length === 1
        ? 'NJ parcel source returned one unambiguous record and enriched the researched property.'
        : `NJ parcel source returned ${records.length} candidate record(s); ownership/unit facts were withheld unless the match was unique.`,
      blocked: records.length !== 1,
      retryable: false,
    };
  }

  if (task.sourceId === 'nyc-acris') {
    if (entity.kind !== 'property') return { text: 'NYC ACRIS resolution requires a property entity.', blocked: true };
    const ownership = await lookupAcrisOwnershipByAddress(entity.label, options.signal);
    if (!ownership) return { text: 'NYC ACRIS did not return one unambiguous BBL with a deed grantee.', blocked: true, retryable: false };
    ingestAcrisOwnership(graph, entity.id, ownership);
    return { text: `NYC ACRIS resolved BBL ${ownership.bbl.borough}-${ownership.bbl.block}-${ownership.bbl.lot} and ${ownership.grantees.length} latest-deed grantee(s).` };
  }

  if (task.sourceId === 'nyc-pluto') {
    if (entity.kind !== 'property') return { text: 'NYC PLUTO resolution requires a property entity.', blocked: true };
    const bbl = parseBbl(entity.aliases ?? [], entity.label);
    if (!bbl) return { text: 'NYC PLUTO requires a resolved BBL before physical-fact lookup.', blocked: true, retryable: true };
    const record = await lookupNycPlutoByBbl(bbl.borough, bbl.block, bbl.lot, options.signal);
    if (!record) return { text: 'NYC PLUTO did not return one unambiguous tax-lot record.', blocked: true, retryable: false };
    ingestNycPluto(graph, entity.id, record);
    const units = Number(record.unitsres ?? 0);
    const area = Number(record.bldgarea ?? 0);
    return {
      text: `NYC PLUTO resolved official physical facts${Number.isFinite(units) && units > 0 ? ` · ${units} residential units` : ''}${Number.isFinite(area) && area > 0 ? ` · ${area.toLocaleString()} sq ft reported building area` : ''}.`
    };
  }

  if (task.sourceId === 'nyc-hpd-registrations') {
    if (entity.kind !== 'property') return { text: 'NYC HPD resolution requires a property entity.', blocked: true };
    const bbl = parseBbl(entity.aliases ?? [], entity.label);
    if (!bbl) return { text: 'NYC HPD requires a resolved BBL before registration/contact lookup.', blocked: true, retryable: true };
    const result = await lookupHpdOwnershipByBbl(bbl.borough, bbl.block, bbl.lot, options.signal);
    ingestHpdOwnership(graph, result, entity.label, undefined, entity.id);
    return { text: `NYC HPD returned ${result.contacts.length} registration contact(s).` };
  }

  if (task.sourceId === 'nys-tax-parcels-public') {
    if (entity.kind !== 'property') return { text: 'NYS tax parcel resolution requires a property entity.', blocked: true };
    if ((entity.geography ?? '').toUpperCase() !== 'NY') return { text: 'NYS tax parcel source applies only to New York properties.', blocked: true, retryable: false };
    const record = await lookupNysTaxParcelByAddress(entity.label, options.signal);
    if (!record) return { text: 'NYS public tax parcels did not return one unambiguous exact-address record. The statewide layer covers participating counties only, so this is not negative ownership evidence.', blocked: true, retryable: false };
    ingestNysTaxParcel(graph, entity.id, record);
    return { text: `NYS tax parcels corroborated ${record.printKey ?? record.sbl ?? 'parcel identity'} and ${[record.primaryOwner, record.additionalOwner].filter(Boolean).length} owner-of-record name(s).` };
  }

  if (task.sourceId === 'phila-opa-properties') {
    if (entity.kind !== 'property') return { text: 'Philadelphia OPA resolution requires a property entity.', blocked: true };
    if (!/\bphiladelphia\b/i.test(entity.label)) return { text: 'Philadelphia OPA applies only to Philadelphia property addresses.', blocked: true, retryable: false };
    const record = await lookupPhiladelphiaOpaByAddress(entity.label, options.signal);
    if (!record) return { text: 'Philadelphia OPA did not return one unambiguous exact-address record.', blocked: true, retryable: false };
    ingestPhiladelphiaOpa(graph, entity.id, record);
    return { text: `Philadelphia OPA corroborated parcel ${record.parcelNumber ?? 'identity'} and ${[record.owner1, record.owner2].filter(Boolean).length} owner-of-record name(s).` };
  }

  if (task.sourceId === 'epa-water-service-areas' || task.sourceId === 'njdep-water-purveyor' || task.sourceId === 'padep-water-service') {
    if (entity.kind !== 'property') return { text: 'Water service-area resolution requires a property entity.', blocked: true };
    const geocode = await geocodeUsAddress(entity.label, options.signal);
    if (!geocode) return { text: 'Census geocoder could not resolve the property address.', blocked: true };
    const areas = task.sourceId === 'njdep-water-purveyor'
      ? await lookupNjPurveyors(geocode.longitude, geocode.latitude, options.signal)
      : task.sourceId === 'padep-water-service'
        ? await lookupPaWaterSuppliers(geocode.longitude, geocode.latitude, options.signal)
        : await lookupEpaWaterSystems(geocode.longitude, geocode.latitude, options.signal);
    ingestWaterServiceAreas(graph, entity.id, areas);
    return { text: `${task.sourceId} returned ${areas.length} intersecting water service area(s).` };
  }

  return { text: `${task.sourceId} is registered but its executable adapter is not connected yet.`, blocked: true };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseBbl(aliases: string[], label: string): { borough: string; block: string; lot: string } | undefined {
  const values = [...aliases, label];
  for (const value of values) {
    const match = value.match(/(?:bbl\s*[:#-]?\s*)?([1-5])[-\s/]([0-9]{1,5})[-\s/]([0-9]{1,4})/i);
    if (match) return { borough: match[1], block: match[2], lot: match[3] };
  }
  return undefined;
}
