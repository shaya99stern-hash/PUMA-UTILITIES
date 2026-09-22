import { addClaim, addEvidence, normalizeLabel, upsertEntity } from './graph';
import type { ResearchGraph } from './types';
import type { CompanyWebsiteResearch } from './sources/company-website';
import type { HpdOwnershipResult, HpdRegistrationContact } from './sources/nyc-hpd';
import type { NjParcelRecord } from './sources/nj-parcels';

export function ingestNjParcel(
  graph: ResearchGraph,
  record: NjParcelRecord,
  sourceUrl = 'https://maps.nj.gov/arcgis/rest/services/Applications/NJ_TaxListSearch/MapServer/2',
  observedAt = new Date().toISOString(),
  targetPropertyId?: string,
): string {
  const label = record.propertyLocation ?? record.pamsPin ?? 'New Jersey parcel';
  const propertyId = targetPropertyId ?? `property:nj:${stableToken(record.pamsPin ?? label)}`;
  const existingProperty = graph.entities.find((entity) => entity.id === propertyId && entity.kind === 'property');
  upsertEntity(graph, {
    id: propertyId,
    kind: 'property',
    label: existingProperty?.label ?? label,
    geography: existingProperty?.geography ?? 'NJ',
    aliases: mergeAliases(existingProperty?.aliases, record.pamsPin ? [`NJ PAMS ${record.pamsPin}`] : []),
  });
  const evidenceId = `evidence:nj-parcel:${stableToken(record.pamsPin ?? label)}`;
  addEvidence(graph, {
    id: evidenceId,
    sourceId: 'nj-parcel-mod4',
    url: sourceUrl,
    observedAt,
    authority: 'official',
    confidence: 0.94,
    excerpt: parcelExcerpt(record),
  });
  if (!targetPropertyId) {
    addClaim(graph, {
      id: `claim:${propertyId}:identity:nj-parcel`,
      subjectId: propertyId,
      fact: 'property.identity',
      value: record.pamsPin ?? label,
      state: 'VERIFIED',
      confidence: 0.94,
      evidenceIds: [evidenceId],
      observedAt,
    });
  }

  const officialUnits = resolvedNjUnitCount(record);
  if (officialUnits !== undefined) {
    addClaim(graph, {
      id: `claim:${propertyId}:units:nj-parcel:${stableToken(record.pamsPin ?? label)}`,
      subjectId: propertyId,
      fact: 'property.units',
      value: officialUnits,
      state: 'VERIFIED',
      confidence: 0.93,
      evidenceIds: [evidenceId],
      observedAt,
    });
  }

  if (record.ownerName?.trim()) {
    const ownerLabel = record.ownerName.trim();
    const ownerId = `company:nj-owner:${stableToken(ownerLabel)}`;
    upsertEntity(graph, { id: ownerId, kind: 'company', label: ownerLabel, geography: 'NJ' });
    addClaim(graph, {
      id: `claim:${propertyId}:owner:${stableToken(ownerLabel)}`,
      subjectId: propertyId,
      fact: 'property.owner',
      objectEntityId: ownerId,
      state: 'SUPPORTED',
      confidence: 0.88,
      evidenceIds: [evidenceId],
      observedAt,
    });
    addClaim(graph, {
      id: `claim:${ownerId}:identity:nj-parcel`,
      subjectId: ownerId,
      fact: 'company.identity',
      value: ownerLabel,
      state: 'SUPPORTED',
      confidence: 0.82,
      evidenceIds: [evidenceId],
      observedAt,
    });
  }

  return propertyId;
}

export function ingestHpdOwnership(
  graph: ResearchGraph,
  result: HpdOwnershipResult,
  label: string,
  observedAt = new Date().toISOString(),
  targetPropertyId?: string,
): string {
  const registration = result.registration;
  const key = registration
    ? `${registration.boroughId}-${registration.block}-${registration.lot}`
    : label;
  const propertyId = targetPropertyId ?? `property:nyc:${stableToken(key)}`;
  const existingProperty = graph.entities.find((entity) => entity.id === propertyId && entity.kind === 'property');
  upsertEntity(graph, {
    id: propertyId,
    kind: 'property',
    label: existingProperty?.label ?? label,
    geography: existingProperty?.geography ?? 'NY',
    aliases: registration
      ? mergeAliases(existingProperty?.aliases, [`BBL ${registration.boroughId}-${registration.block}-${registration.lot}`])
      : existingProperty?.aliases,
  });

  result.sourceUrls.forEach((url, index) => addEvidence(graph, {
    id: `evidence:hpd:${stableToken(key)}:${index}`,
    sourceId: 'nyc-hpd-registrations',
    url,
    observedAt,
    authority: 'official',
    confidence: 0.95,
    excerpt: registration ? `HPD registration ${registration.registrationId} for BBL ${key}` : `No current HPD registration resolved for ${label}`,
  }));

  if (registration && !targetPropertyId) {
    addClaim(graph, {
      id: `claim:${propertyId}:identity:hpd`,
      subjectId: propertyId,
      fact: 'property.identity',
      value: key,
      state: 'VERIFIED',
      confidence: 0.96,
      evidenceIds: [`evidence:hpd:${stableToken(key)}:0`],
      observedAt,
    });
  }

  for (const contact of result.contacts) ingestHpdContact(graph, propertyId, contact, key, observedAt);
  return propertyId;
}

export function ingestCompanyWebsite(
  graph: ResearchGraph,
  companyId: string,
  research: CompanyWebsiteResearch,
  observedAt = new Date().toISOString(),
): void {
  const company = graph.entities.find((entity) => entity.id === companyId);
  if (!company || company.kind !== 'company') throw new Error(`Company entity ${companyId} was not found.`);
  const evidenceByUrl = new Map<string, string>();

  const ensureEvidence = (url: string): string => {
    const existing = evidenceByUrl.get(url);
    if (existing) return existing;
    const id = `evidence:website:${stableToken(companyId)}:${stableToken(url)}`;
    addEvidence(graph, {
      id,
      sourceId: 'company-first-party-web',
      url,
      observedAt,
      authority: 'first-party',
      confidence: 0.84,
    });
    evidenceByUrl.set(url, id);
    return id;
  };

  const websiteEvidence = ensureEvidence(research.seedUrl);
  addClaim(graph, {
    id: `claim:${companyId}:identity:first-party`,
    subjectId: companyId,
    fact: 'company.identity',
    value: company.label,
    state: 'SUPPORTED',
    confidence: 0.8,
    evidenceIds: [websiteEvidence],
    observedAt,
  });
  addClaim(graph, {
    id: `claim:${companyId}:website:first-party`,
    subjectId: companyId,
    fact: 'company.website',
    value: new URL(research.seedUrl).origin,
    state: 'SUPPORTED',
    confidence: 0.88,
    evidenceIds: [websiteEvidence],
    observedAt,
  });

  for (const contact of research.contacts) {
    const evidenceId = ensureEvidence(contact.sourceUrl);
    addClaim(graph, {
      id: `claim:${companyId}:${contact.type}:${stableToken(contact.value)}`,
      subjectId: companyId,
      fact: contact.type === 'email' ? 'company.email' : 'company.phone',
      value: contact.value,
      state: 'SUPPORTED',
      confidence: 0.82,
      evidenceIds: [evidenceId],
      observedAt,
    });
  }

  for (const signal of research.portfolioSignals ?? []) {
    const evidenceId = ensureEvidence(signal.sourceUrl);
    addClaim(graph, {
      id: `claim:${companyId}:portfolio:${signal.qualifier}:${signal.count}:${stableToken(signal.label)}`,
      subjectId: companyId,
      fact: signal.qualifier === 'exact' ? 'company.portfolio' : 'company.portfolioLowerBound',
      value: signal.count,
      state: 'SUPPORTED',
      confidence: signal.qualifier === 'exact' ? 0.86 : 0.82,
      evidenceIds: [evidenceId],
      observedAt,
      qualifier: signal.qualifier,
      statement: signal.text,
      metricLabel: signal.label,
    });
  }

  for (const signal of research.ownerOperatorSignals ?? []) {
    const evidenceId = ensureEvidence(signal.sourceUrl);
    addClaim(graph, {
      id: `claim:${companyId}:owner-operator:${stableToken(signal.text)}`,
      subjectId: companyId,
      fact: 'company.ownerOperator',
      value: signal.text,
      state: 'SUPPORTED',
      confidence: 0.86,
      evidenceIds: [evidenceId],
      observedAt,
    });
  }

  const discoveredProperties = research.propertySignals ?? [];
  if (discoveredProperties.length >= 2) {
    const distinctAddresses = [...new Set(discoveredProperties.map((property) => normalizeLabel(property.address)).filter(Boolean))];
    if (distinctAddresses.length >= 2) {
      const evidenceIds = [...new Set(discoveredProperties.map((property) => ensureEvidence(property.sourceUrl)))];
      addClaim(graph, {
        id: `claim:${companyId}:portfolio:discovered-addresses:${distinctAddresses.length}`,
        subjectId: companyId,
        fact: 'company.portfolioLowerBound',
        value: distinctAddresses.length,
        state: 'SUPPORTED',
        confidence: 0.78,
        evidenceIds,
        observedAt,
        qualifier: 'at-least',
        statement: `At least ${distinctAddresses.length} distinct property addresses were discovered on the company's first-party site.`,
        metricLabel: 'properties',
      });
    }
  }

  for (const property of discoveredProperties) {
    const propertyId = `property:first-party:${stableToken(companyId)}:${stableToken(property.address)}`;
    upsertEntity(graph, { id: propertyId, kind: 'property', label: property.address, geography: property.state ?? company.geography });
    const evidenceId = ensureEvidence(property.sourceUrl);
    addClaim(graph, {
      id: `claim:${propertyId}:identity:first-party`,
      subjectId: propertyId,
      fact: 'property.identity',
      value: property.address,
      state: 'SUPPORTED',
      confidence: 0.82,
      evidenceIds: [evidenceId],
      observedAt,
    });
    addClaim(graph, {
      id: `claim:${propertyId}:manager:first-party:${stableToken(companyId)}`,
      subjectId: propertyId,
      fact: 'property.manager',
      objectEntityId: companyId,
      state: 'SUPPORTED',
      confidence: 0.78,
      evidenceIds: [evidenceId],
      observedAt,
    });
    if (typeof property.units === 'number') {
      addClaim(graph, {
        id: `claim:${propertyId}:units:first-party`,
        subjectId: propertyId,
        fact: 'property.units',
        value: property.units,
        state: 'SUPPORTED',
        confidence: 0.82,
        evidenceIds: [evidenceId],
        observedAt,
      });
    }
    if (typeof property.grossSquareFeet === 'number') {
      addClaim(graph, {
        id: `claim:${propertyId}:gross-sqft:first-party`,
        subjectId: propertyId,
        fact: 'property.grossSquareFeet',
        value: property.grossSquareFeet,
        state: 'SUPPORTED',
        confidence: 0.8,
        evidenceIds: [evidenceId],
        observedAt,
      });
    }
  }

  for (const signal of research.leadershipSignals) {
    const evidenceId = ensureEvidence(signal.sourceUrl);
    const person = parseLeadershipSignal(signal.text);
    if (!person) continue;
    const personId = `person:${stableToken(companyId)}:${stableToken(person.name)}`;
    upsertEntity(graph, { id: personId, kind: 'person', label: person.name, geography: company.geography });
    addClaim(graph, {
      id: `claim:${personId}:title:${stableToken(person.title)}`,
      subjectId: personId,
      fact: 'person.title',
      value: person.title,
      state: 'SUPPORTED',
      confidence: 0.76,
      evidenceIds: [evidenceId],
      observedAt,
    });
    addClaim(graph, {
      id: `claim:${companyId}:decision-maker:${stableToken(person.name)}`,
      subjectId: companyId,
      fact: 'person.decisionMaker',
      objectEntityId: personId,
      state: 'SUPPORTED',
      confidence: 0.74,
      evidenceIds: [evidenceId],
      observedAt,
    });

    for (const contact of research.contacts.filter((item) => item.sourceUrl === signal.sourceUrl && contactMatchesPerson(item.context, person.name))) {
      const contactEvidenceId = ensureEvidence(contact.sourceUrl);
      addClaim(graph, {
        id: `claim:${personId}:${contact.type}:${stableToken(contact.value)}`,
        subjectId: personId,
        fact: contact.type === 'email' ? 'person.email' : 'person.phone',
        value: contact.value,
        state: 'SUPPORTED',
        confidence: 0.8,
        evidenceIds: [contactEvidenceId],
        observedAt,
      });
    }
  }
}

function ingestHpdContact(
  graph: ResearchGraph,
  propertyId: string,
  contact: HpdRegistrationContact,
  key: string,
  observedAt: string,
): void {
  const name = contact.corporationName?.trim() || [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
  if (!name) return;
  const contactType = contact.type?.toLowerCase() ?? '';
  const isOrganization = Boolean(contact.corporationName?.trim());
  const entityId = `${isOrganization ? 'company' : 'person'}:hpd:${stableToken(name)}`;
  upsertEntity(graph, { id: entityId, kind: isOrganization ? 'company' : 'person', label: name, geography: 'NY' });
  const evidenceId = `evidence:hpd-contact:${stableToken(key)}:${stableToken(contact.id ?? `${contact.type}:${name}`)}`;
  addEvidence(graph, {
    id: evidenceId,
    sourceId: 'nyc-hpd-registrations',
    url: 'https://data.cityofnewyork.us/Housing-Development/Registration-Contacts/feu5-w2e2',
    observedAt,
    authority: 'official',
    confidence: 0.95,
    excerpt: `${contact.type ?? 'HPD contact'}: ${name}`,
  });

  if (/(corporateowner|individualowner|jointowner)/.test(contactType)) {
    addClaim(graph, {
      id: `claim:${propertyId}:owner:${stableToken(name)}`,
      subjectId: propertyId,
      fact: 'property.owner',
      objectEntityId: entityId,
      state: 'VERIFIED',
      confidence: 0.94,
      evidenceIds: [evidenceId],
      observedAt,
    });
  }
  if (/(agent|site manager|managingagent)/.test(contactType)) {
    addClaim(graph, {
      id: `claim:${propertyId}:manager:${stableToken(name)}`,
      subjectId: propertyId,
      fact: 'property.manager',
      objectEntityId: entityId,
      state: 'SUPPORTED',
      confidence: 0.9,
      evidenceIds: [evidenceId],
      observedAt,
    });
  }
  if (contact.businessPhone && !isOrganization) {
    addClaim(graph, {
      id: `claim:${entityId}:phone:hpd`,
      subjectId: entityId,
      fact: 'person.phone',
      value: contact.businessPhone,
      state: 'SUPPORTED',
      confidence: 0.8,
      evidenceIds: [evidenceId],
      observedAt,
    });
  }
}

function parseLeadershipSignal(text: string): { name: string; title: string } | undefined {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const titlePattern = '(?:Owner|Founder|Principal|Managing Principal|Managing Partner|President|Chief Executive Officer|CEO|Chief Operating Officer|COO|Head of Property Management|Property Manager|Asset Manager|Director of Operations|Vice President)';
  const patterns = [
    new RegExp(`^([A-Z][A-Za-z'.-]+(?:\\s+[A-Z][A-Za-z'.-]+){1,3})\\s*[-–—|,]\\s*(${titlePattern})\\b`, 'i'),
    new RegExp(`^(${titlePattern})\\s*[-–—|,:]\\s*([A-Z][A-Za-z'.-]+(?:\\s+[A-Z][A-Za-z'.-]+){1,3})\\b`, 'i'),
  ];
  const first = cleaned.match(patterns[0]);
  if (first) return { name: titleCaseName(first[1]), title: first[2].trim() };
  const second = cleaned.match(patterns[1]);
  if (second) return { name: titleCaseName(second[2]), title: second[1].trim() };
  return undefined;
}

function contactMatchesPerson(context: string | undefined, name: string): boolean {
  if (!context) return false;
  const normalizedContext = normalizeLabel(context);
  const normalizedName = normalizeLabel(name);
  if (normalizedContext.includes(normalizedName)) return true;
  const tokens = normalizedName.split(' ').filter((token) => token.length >= 3);
  return tokens.length >= 2 && tokens.every((token) => normalizedContext.includes(token));
}

function titleCaseName(value: string): string {
  return value.split(/\s+/).map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(' ');
}

function parcelExcerpt(record: NjParcelRecord): string {
  return [record.pamsPin, record.propertyLocation, record.ownerName, record.buildingDescription, record.propertyUse]
    .filter(Boolean)
    .join(' · ')
    .slice(0, 500);
}

function stableToken(value: string): string {
  const normalized = normalizeLabel(value) || value.toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}


function resolvedNjUnitCount(record: NjParcelRecord): number | undefined {
  const values = [record.dwellingUnits, record.commercialDwellingUnits]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  if (!values.length) return undefined;
  const unique = [...new Set(values)];
  return unique.length === 1 && unique[0] <= 20_000 ? unique[0] : undefined;
}

function mergeAliases(existing: string[] | undefined, incoming: string[]): string[] | undefined {
  const values = [...new Set([...(existing ?? []), ...incoming].filter(Boolean))];
  return values.length ? values : undefined;
}
