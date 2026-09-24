import { normalizeLabel } from './graph';
import { assessResearchRun } from './qualification';
import { rankDecisionMakers } from './decision-maker';
import { estimatePropertyWaterCost } from './water-cost';
import { linkedCompanyPropertyIds } from './portfolio-links';
import { buildOpportunityIntelligence } from './opportunity';
import { parseTariffMetadata, tariffFreshness } from './tariff-metadata';
import type { ResearchRunResult } from './runner';
import type { ResearchClaim, ResearchEvidence, ResearchGraph } from './types';
import type { Company, Parcel, Person, PortfolioMetric, Property, Provenance, Tariff, UtilityService, Workspace } from '../types';

export type ResearchMergeSummary = {
  companyId: string;
  createdCompany: boolean;
  peopleAdded: number;
  propertiesAdded: number;
  utilitiesAdded: number;
  parcelsAdded: number;
  tariffsAdded: number;
};

export function mergeResearchRunIntoWorkspace(workspace: Workspace, result: ResearchRunResult): { workspace: Workspace; summary: ResearchMergeSummary } {
  const graph = result.graph;
  const root = graph.entities.find((entity) => entity.id === result.rootEntityId);
  if (!root || root.kind !== 'company') throw new Error('Only company-rooted research runs can be saved to Prospects.');

  const now = new Date().toISOString();
  const existing = workspace.companies.find((company) => normalizeLabel(company.name) === normalizeLabel(root.label));
  const companyId = existing?.id ?? `research_company_${token(root.id)}`;
  const provenance = provenanceForSubject(graph, root.id);
  const rankedDecisionMakers = rankDecisionMakers(graph, root.id);
  const people = rankedDecisionMakers.map((ranked) => projectPerson(graph, ranked.personId)).filter((value): value is Person => Boolean(value));
  const officeContact = projectOfficeContact(graph, root.id);
  if (officeContact) people.push(officeContact);

  const website = stringClaim(graph, root.id, 'company.website');
  const publicEmail = stringClaim(graph, root.id, 'company.email');
  const publicPhone = stringClaim(graph, root.id, 'company.phone');
  const portfolioMetrics = projectPortfolioMetrics(graph, root.id);
  const exactBuildings = portfolioMetrics.find((metric) => ['buildings', 'properties', 'locations', 'communities'].includes(metric.label) && metric.qualifier !== 'at-least');
  const exactUnits = portfolioMetrics.find((metric) => metric.label === 'apartments' && metric.qualifier !== 'at-least');
  const assessment = assessResearchRun(result);
  const opportunityIntelligence = buildOpportunityIntelligence(result);

  const company: Company = {
    ...(existing ?? {
      id: companyId, name: root.label, stage: 'Research', headquarters: { status: 'unknown' }, portfolioBuildings: { status: 'unknown' }, portfolioUnits: { status: 'unknown' }, people: [], provenance: [], createdAt: now, updatedAt: now,
    }),
    name: root.label,
    stage: existing?.stage ?? 'Research',
    market: root.geography ?? existing?.market,
    website: website ?? existing?.website,
    publicEmail: publicEmail ?? existing?.publicEmail,
    publicPhone: publicPhone ?? existing?.publicPhone,
    prospectAssessment: assessment,
    opportunityIntelligence,
    nextAction: existing?.nextAction ?? opportunityIntelligence.nextActions[0],
    portfolioBuildings: exactBuildings ? { value: exactBuildings.value, status: 'verified-public', provenanceId: exactBuildings.provenanceId, updatedAt: now } : existing?.portfolioBuildings ?? { status: 'unknown' },
    portfolioUnits: exactUnits ? { value: exactUnits.value, status: 'verified-public', provenanceId: exactUnits.provenanceId, updatedAt: now } : existing?.portfolioUnits ?? { status: 'unknown' },
    portfolio: portfolioMetrics.length ? mergePortfolio(existing?.portfolio ?? [], portfolioMetrics) : existing?.portfolio,
    people: mergePeople(existing?.people ?? [], people),
    provenance: mergeProvenance(existing?.provenance ?? [], provenance),
    updatedAt: now,
  };

  const linkedPropertyIds = linkedCompanyPropertyIds(graph, root.id);
  const projectedProperties = linkedPropertyIds
    .map((id) => projectProperty(graph, id, companyId, now))
    .filter((value): value is Property => Boolean(value))
    .map((property) => {
      const current = workspace.properties.find((item) => item.companyId === companyId && normalizeLabel(item.name) === normalizeLabel(property.name));
      return current ? { ...property, id: current.id, createdAt: current.createdAt, parcelIds: [...current.parcelIds] } : property;
    });

  const propertyIdMap = new Map(projectedProperties.map((property) => [normalizeLabel(property.name), property.id]));
  const projectedParcels: Parcel[] = [];
  for (const propertyEntityId of linkedPropertyIds) {
    const entity = graph.entities.find((item) => item.id === propertyEntityId && item.kind === 'property');
    if (!entity) continue;
    const propertyId = propertyIdMap.get(normalizeLabel(entity.label));
    if (!propertyId) continue;
    const identifiers = parcelIdentifiers(entity.aliases ?? []);
    const parcelIds = identifiers.map((identifier) => `research_parcel_${token(propertyId + identifier)}`);
    const projected = projectedProperties.find((item) => item.id === propertyId);
    if (projected) projected.parcelIds = [...new Set([...projected.parcelIds, ...parcelIds])];
    identifiers.forEach((identifier, index) => projectedParcels.push({ id: parcelIds[index], propertyId, identifier, jurisdiction: entity.geography, status: 'verified-public', provenanceId: firstProvenanceId(graph, propertyEntityId) }));
  }

  const projectedUtilities: UtilityService[] = [];
  const projectedTariffs: Tariff[] = [];
  for (const propertyEntityId of linkedPropertyIds) {
    const entity = graph.entities.find((item) => item.id === propertyEntityId);
    if (!entity) continue;
    const workspacePropertyId = propertyIdMap.get(normalizeLabel(entity.label));
    if (!workspacePropertyId) continue;

    for (const claim of trustedClaims(graph, propertyEntityId, 'utility.provider')) {
      if (!claim.objectEntityId) continue;
      const utilityEntity = graph.entities.find((item) => item.id === claim.objectEntityId);
      if (!utilityEntity) continue;
      const existingUtility = workspace.utilities.find((item) => item.propertyId === workspacePropertyId && normalizeLabel(item.provider) === normalizeLabel(utilityEntity.label));
      const workspaceUtilityId = existingUtility?.id ?? `research_utility_${token(workspacePropertyId + utilityEntity.id)}`;
      const benchmark = estimatePropertyWaterCost(graph, propertyEntityId);
      projectedUtilities.push({
        id: workspaceUtilityId,
        propertyId: workspacePropertyId,
        provider: utilityEntity.label,
        serviceArea: utilityEntity.geography,
        capability: existingUtility?.capability ?? 'unknown',
        portal: existingUtility?.portal ?? 'unknown',
        status: 'verified-public',
        provenanceId: claim.evidenceIds[0] ? `research_prov_${token(claim.evidenceIds[0])}` : undefined,
        amiProgram: evidenceValueFromClaim(graph, utilityEntity.id, 'utility.amiCapability', now),
        rateSummary: evidenceValueFromClaim(graph, utilityEntity.id, 'utility.rateSchedule', now),
        benchmarkCost: benchmark?.utilityId === utilityEntity.id ? {
          annualVariableCost: benchmark.annualVariableCost, monthlyVariableCost: benchmark.monthlyVariableCost, annualFixedWaterCharge: benchmark.annualFixedWaterCharge, monthlyFixedWaterCharge: benchmark.monthlyFixedWaterCharge, annualEstimatedWaterCost: benchmark.annualEstimatedWaterCost, monthlyEstimatedWaterCost: benchmark.monthlyEstimatedWaterCost, benchmarkAnnualGallons: benchmark.benchmarkAnnualGallons, annualVariableCostLow: benchmark.annualVariableCostLow, annualVariableCostHigh: benchmark.annualVariableCostHigh, basis: benchmark.basis, includesFixedCharges: benchmark.includesFixedCharges, methodology: benchmark.methodology, sourceUrls: benchmark.sourceUrls, status: 'estimated',
        } : undefined,
      });

      for (const rateClaim of trustedClaims(graph, utilityEntity.id, 'utility.rateSchedule')) {
        if (typeof rateClaim.value !== 'string' || !rateClaim.value.trim()) continue;
        const evidence = rateClaim.evidenceIds.map((id) => graph.evidence.find((item) => item.id === id)).find((item): item is ResearchEvidence => Boolean(item));
        const metadata = parseTariffMetadata(rateClaim.value);
        const existingTariff = workspace.tariffs.find((item) => item.utilityServiceId === workspaceUtilityId && normalizeLabel(item.publishedText ?? item.label) === normalizeLabel(rateClaim.value as string));
        projectedTariffs.push({
          id: existingTariff?.id ?? `research_tariff_${token(workspaceUtilityId + ':' + rateClaim.id)}`,
          utilityServiceId: workspaceUtilityId,
          label: `${utilityEntity.label}${metadata.customerClass ? ` ${metadata.customerClass}` : ''} water tariff`,
          effectiveFrom: metadata.effectiveFrom,
          effectiveTo: metadata.effectiveTo,
          customerClass: metadata.customerClass,
          freshness: tariffFreshness(metadata, now),
          sourceUrl: evidence?.url,
          retrievedAt: evidence?.observedAt ?? rateClaim.observedAt,
          publishedText: rateClaim.value.trim(),
          status: 'verified-public',
          provenanceId: evidence ? `research_prov_${token(evidence.id)}` : undefined,
          note: metadata.effectiveTo ? `Published validity through ${metadata.effectiveTo}.` : 'No explicit tariff expiration was parsed; freshness remains source-observation dependent.',
        });
      }
    }
  }

  const next: Workspace = {
    ...workspace,
    companies: existing ? workspace.companies.map((item) => item.id === companyId ? company : item) : [...workspace.companies, company],
    properties: mergeProperties(workspace.properties, projectedProperties),
    parcels: mergeParcels(workspace.parcels, projectedParcels),
    utilities: mergeUtilities(workspace.utilities, projectedUtilities),
    tariffs: mergeTariffs(workspace.tariffs, projectedTariffs),
    updatedAt: now,
  };

  return {
    workspace: next,
    summary: {
      companyId,
      createdCompany: !existing,
      peopleAdded: Math.max(0, company.people.length - (existing?.people.length ?? 0)),
      propertiesAdded: projectedProperties.filter((property) => !workspace.properties.some((item) => item.companyId === companyId && normalizeLabel(item.name) === normalizeLabel(property.name))).length,
      utilitiesAdded: projectedUtilities.filter((utility) => !workspace.utilities.some((item) => item.propertyId === utility.propertyId && normalizeLabel(item.provider) === normalizeLabel(utility.provider))).length,
      parcelsAdded: projectedParcels.filter((parcel) => !workspace.parcels.some((item) => item.propertyId === parcel.propertyId && normalizeLabel(item.identifier) === normalizeLabel(parcel.identifier))).length,
      tariffsAdded: projectedTariffs.filter((tariff) => !workspace.tariffs.some((item) => item.utilityServiceId === tariff.utilityServiceId && normalizeLabel(item.publishedText ?? item.label) === normalizeLabel(tariff.publishedText ?? tariff.label))).length,
    },
  };
}

function projectPerson(graph: ResearchGraph, id: string): Person | undefined {
  const entity = graph.entities.find((item) => item.id === id && item.kind === 'person');
  if (!entity) return undefined;
  return { id:`research_person_${token(id)}`, name:entity.label, role:stringClaim(graph,id,'person.title'), email:stringClaim(graph,id,'person.email'), phone:stringClaim(graph,id,'person.phone'), status:'verified-public', provenanceId:firstProvenanceId(graph,id) };
}

function projectOfficeContact(graph: ResearchGraph, companyId: string): Person | undefined {
  const email = stringClaim(graph, companyId, 'company.email'); const phone = stringClaim(graph, companyId, 'company.phone');
  if (!email && !phone) return undefined;
  const company = graph.entities.find((entity) => entity.id === companyId);
  return { id:`research_office_${token(companyId)}`, name:`${company?.label ?? 'Company'} office`, role:'Published business contact', email, phone, status:'verified-public', provenanceId:firstProvenanceId(graph,companyId) };
}

function projectProperty(graph: ResearchGraph, entityId: string, companyId: string, now: string): Property | undefined {
  const entity = graph.entities.find((item) => item.id === entityId && item.kind === 'property');
  if (!entity) return undefined;
  return { id:`research_property_${token(entityId)}`, companyId, name:entity.label, address:{ value:entity.label, status:'verified-public', updatedAt:now }, units:numberEvidenceValue(graph,entityId,'property.units',now), grossSquareFeet:numberEvidenceValue(graph,entityId,'property.grossSquareFeet',now), state:entity.geography ?? '', parcelIds:[], provenance:provenanceForSubject(graph,entityId), createdAt:now, updatedAt:now };
}

function provenanceForSubject(graph: ResearchGraph, subjectId: string): Provenance[] {
  const evidenceIds = new Set(graph.claims.filter((claim) => claim.subjectId === subjectId && trusted(claim)).flatMap((claim) => claim.evidenceIds));
  return [...evidenceIds].map((id) => { const evidence = graph.evidence.find((item) => item.id === id); return evidence ? projectProvenance(evidence) : undefined; }).filter((value): value is Provenance => Boolean(value));
}
function projectProvenance(evidence: ResearchEvidence): Provenance { return { id:`research_prov_${token(evidence.id)}`, label:evidence.sourceId, status:'verified-public', reference:evidence.url, retrievedAt:evidence.observedAt, note:evidence.excerpt }; }
function firstProvenanceId(graph: ResearchGraph, subjectId: string): string | undefined { const evidenceId = graph.claims.find((claim) => claim.subjectId === subjectId && trusted(claim) && claim.evidenceIds.length)?.evidenceIds[0]; return evidenceId ? `research_prov_${token(evidenceId)}` : undefined; }
function stringClaim(graph: ResearchGraph, subjectId: string, fact: ResearchClaim['fact']): string | undefined { const claim = trustedClaims(graph,subjectId,fact).find((item) => typeof item.value === 'string' && item.value.trim()); return typeof claim?.value === 'string' ? claim.value.trim() : undefined; }
function evidenceValueFromClaim(graph: ResearchGraph, subjectId: string, fact: ResearchClaim['fact'], now: string) { const claim = trustedClaims(graph,subjectId,fact).find((item) => typeof item.value === 'string' && item.value.trim()); if (!claim || typeof claim.value !== 'string') return { status:'unknown' as const }; return { value:claim.value.trim(), status:'verified-public' as const, provenanceId:claim.evidenceIds[0] ? `research_prov_${token(claim.evidenceIds[0])}` : undefined, updatedAt:now }; }
function numberEvidenceValue(graph: ResearchGraph, subjectId: string, fact: ResearchClaim['fact'], now: string) { const claim = trustedClaims(graph,subjectId,fact).find((item) => typeof item.value === 'number' && Number.isFinite(item.value)); if (!claim || typeof claim.value !== 'number') return undefined; return { value:claim.value, status:'verified-public' as const, provenanceId:claim.evidenceIds[0] ? `research_prov_${token(claim.evidenceIds[0])}` : undefined, updatedAt:now }; }

function projectPortfolioMetrics(graph: ResearchGraph, companyId: string): PortfolioMetric[] {
  return [...trustedClaims(graph,companyId,'company.portfolio'), ...trustedClaims(graph,companyId,'company.portfolioLowerBound')]
    .filter((claim) => typeof claim.value === 'number' && Number.isFinite(claim.value))
    .map((claim): PortfolioMetric => ({ value:claim.value as number, label:claim.metricLabel ?? 'buildings', qualifier:claim.fact === 'company.portfolioLowerBound' ? 'at-least' : (claim.qualifier ?? 'exact'), status:'verified-public', provenanceId:claim.evidenceIds[0] ? `research_prov_${token(claim.evidenceIds[0])}` : undefined, statement:claim.statement }));
}
function mergePortfolio(existing: PortfolioMetric[], incoming: PortfolioMetric[]): PortfolioMetric[] { const map = new Map(existing.map((item) => [`${item.label}:${item.value}:${item.qualifier ?? 'exact'}`,item])); for (const item of incoming) map.set(`${item.label}:${item.value}:${item.qualifier ?? 'exact'}`,item); return [...map.values()]; }
function trustedClaims(graph: ResearchGraph, subjectId: string, fact: ResearchClaim['fact']): ResearchClaim[] { return graph.claims.filter((claim) => claim.subjectId === subjectId && claim.fact === fact && trusted(claim)); }
function trusted(claim: ResearchClaim): boolean { return (claim.state === 'VERIFIED' || claim.state === 'SUPPORTED') && claim.confidence >= 0.7; }
function mergePeople(existing: Person[], incoming: Person[]): Person[] {
  const map = new Map(existing.map((item) => [normalizeLabel(item.name), item]));
  for (const item of incoming) {
    const key = normalizeLabel(item.name);
    const current = map.get(key);
    if (current?.status === 'user-entered') {
      map.set(key, current);
      continue;
    }
    map.set(key, current ? { ...current, ...item, id: current.id } : item);
  }
  return [...map.values()];
}
function mergeProvenance(existing: Provenance[], incoming: Provenance[]): Provenance[] { const map = new Map(existing.map((item) => [item.reference ?? item.id,item])); for (const item of incoming) map.set(item.reference ?? item.id,item); return [...map.values()]; }
function mergeProperties(existing: Property[], incoming: Property[]): Property[] {
  const next = [...existing];
  for (const property of incoming) {
    const index = next.findIndex((item) =>
      item.companyId === property.companyId && normalizeLabel(item.name) === normalizeLabel(property.name),
    );
    if (index < 0) {
      next.push(property);
      continue;
    }

    const current = next[index];
    next[index] = {
      ...current,
      ...property,
      id: current.id,
      createdAt: current.createdAt,
      address: current.address.status === 'user-entered' ? current.address : property.address,
      units: current.units?.status === 'user-entered' ? current.units : (property.units ?? current.units),
      grossSquareFeet: current.grossSquareFeet?.status === 'user-entered'
        ? current.grossSquareFeet
        : (property.grossSquareFeet ?? current.grossSquareFeet),
    };
  }
  return next;
}
function parcelIdentifiers(aliases: string[]): string[] { return [...new Set(aliases.filter((alias) => /^(?:BBL\s|NJ PAMS\s|Philadelphia OPA\s|NYS tax parcel\s|(?:Bucks|Montgomery|Chester|Delaware) County parcel\s)/i.test(alias.trim())).map((alias) => alias.trim()))]; }
function mergeParcels(existing: Parcel[], incoming: Parcel[]): Parcel[] { const next=[...existing]; for (const parcel of incoming) { const index=next.findIndex((item) => item.propertyId===parcel.propertyId && normalizeLabel(item.identifier)===normalizeLabel(parcel.identifier)); if (index>=0) next[index]={...next[index],...parcel,id:next[index].id}; else next.push(parcel); } return next; }
function mergeUtilities(existing: UtilityService[], incoming: UtilityService[]): UtilityService[] { const next=[...existing]; for (const utility of incoming) { const index=next.findIndex((item) => item.propertyId===utility.propertyId && normalizeLabel(item.provider)===normalizeLabel(utility.provider)); if (index>=0) next[index]={...next[index],...utility,id:next[index].id}; else next.push(utility); } return next; }
function mergeTariffs(existing: Tariff[], incoming: Tariff[]): Tariff[] { const next=[...existing]; for (const tariff of incoming) { const key=normalizeLabel(tariff.publishedText ?? tariff.label); const index=next.findIndex((item) => item.utilityServiceId===tariff.utilityServiceId && normalizeLabel(item.publishedText ?? item.label)===key); if (index>=0) next[index]={...next[index],...tariff,id:next[index].id}; else next.push(tariff); } return next; }
function token(value: string): string { let hash=2166136261; for (let index=0; index<value.length; index+=1) { hash^=value.charCodeAt(index); hash=Math.imul(hash,16777619); } return (hash>>>0).toString(36); }
