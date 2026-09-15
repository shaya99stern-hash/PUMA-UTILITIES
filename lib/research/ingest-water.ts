import { addClaim, addEvidence, normalizeLabel, upsertEntity } from './graph';
import type { ResearchGraph } from './types';
import type { WaterServiceArea } from './sources/water-service';

export function ingestWaterServiceAreas(
  graph: ResearchGraph,
  propertyId: string,
  areas: WaterServiceArea[],
  observedAt = new Date().toISOString(),
): string[] {
  const property = graph.entities.find((entity) => entity.id === propertyId);
  if (!property || property.kind !== 'property') throw new Error(`Property entity ${propertyId} was not found.`);
  const utilityIds: string[] = [];

  for (const area of areas) {
    const identity = area.publicWaterSystemId || area.provider;
    const utilityId = `utility:${stableToken(identity)}`;
    utilityIds.push(utilityId);
    upsertEntity(graph, {
      id: utilityId,
      kind: 'utility',
      label: area.provider,
      geography: area.state ?? property.geography,
      aliases: area.publicWaterSystemId ? [area.publicWaterSystemId] : undefined,
    });

    const evidenceId = `evidence:water:${stableToken(propertyId)}:${stableToken(`${area.boundarySource}:${identity}`)}`;
    const confidence = area.boundaryConfidence === 'authoritative' ? 0.93 : 0.68;
    addEvidence(graph, {
      id: evidenceId,
      sourceId: waterSourceId(area),
      url: waterSourceUrl(area),
      observedAt,
      authority: 'official',
      confidence,
      excerpt: `${area.provider}${area.publicWaterSystemId ? ` · ${area.publicWaterSystemId}` : ''} · ${area.boundaryConfidence} service-area boundary`,
    });

    addClaim(graph, {
      id: `claim:${propertyId}:utility:${stableToken(identity)}`,
      subjectId: propertyId,
      fact: 'utility.provider',
      objectEntityId: utilityId,
      state: area.boundaryConfidence === 'authoritative' ? 'SUPPORTED' : 'INFERRED',
      confidence,
      evidenceIds: [evidenceId],
      observedAt,
    });
    addClaim(graph, {
      id: `claim:${utilityId}:provider:${stableToken(identity)}`,
      subjectId: utilityId,
      fact: 'utility.provider',
      value: area.provider,
      state: 'VERIFIED',
      confidence: 0.95,
      evidenceIds: [evidenceId],
      observedAt,
    });
  }
  return [...new Set(utilityIds)];
}

function waterSourceId(area: WaterServiceArea): string {
  return area.boundarySource === 'njdep'
    ? 'njdep-water-purveyor'
    : area.boundarySource === 'padep'
      ? 'padep-water-service'
      : 'epa-water-service-areas';
}

function waterSourceUrl(area: WaterServiceArea): string {
  if (area.boundarySource === 'njdep') return 'https://mapsdep.nj.gov/arcgis/rest/services/Features/Utilities/MapServer/13';
  if (area.boundarySource === 'padep') return 'https://mapservices.pasda.psu.edu/server/rest/services/pasda/DEP2/MapServer/8';
  return area.reportUrl || 'https://www.epa.gov/ground-water-and-drinking-water/public-water-system-service-areas';
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
