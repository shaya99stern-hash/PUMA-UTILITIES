import type { ResearchGraph } from '../types';
import {
  ingestPaCountyParcel,
  isLikelySupportedPaCountyAddress,
  lookupPaCountyParcelByAddress,
  normalizePaCountyParcelStreet,
  type PaCountyParcelRecord,
} from './pa-county-parcels';

/**
 * Compatibility surface retained for older tests/imports. The executable
 * `pa-county-assessment` source now routes Bucks, Montgomery, Chester, and
 * Delaware counties through the shared adapter.
 */
export type BucksParcelRecord = {
  parcelNumber?: string;
  address?: string;
  municipality?: string;
  owner1?: string;
  owner2?: string;
  careOf?: string;
  landValue?: number;
  buildingValue?: number;
  totalValue?: number;
  landUseCode?: string;
  modifiedAt?: string;
  county?: PaCountyParcelRecord['county'];
  residentialUnits?: number;
  sourceUrl?: string;
  sourceYear?: number;
};

export const normalizeBucksParcelStreet = normalizePaCountyParcelStreet;

export function isLikelyBucksCountyAddress(address: string): boolean {
  return isLikelySupportedPaCountyAddress(address);
}

export async function lookupBucksParcelByAddress(address: string, signal?: AbortSignal): Promise<BucksParcelRecord | undefined> {
  const record = await lookupPaCountyParcelByAddress(address, signal);
  if (!record) return undefined;
  return {
    parcelNumber: record.parcelNumber,
    address: record.address,
    municipality: record.municipality,
    owner1: record.owner1,
    owner2: record.owner2,
    totalValue: record.assessedValue,
    county: record.county,
    residentialUnits: record.residentialUnits,
    sourceUrl: record.sourceUrl,
    sourceYear: record.sourceYear,
  };
}

export function ingestBucksParcel(
  graph: ResearchGraph,
  propertyId: string,
  record: BucksParcelRecord,
  sourceUrl?: string,
  observedAt = new Date().toISOString(),
): void {
  ingestPaCountyParcel(graph, propertyId, {
    county: record.county ?? 'Bucks',
    parcelNumber: record.parcelNumber,
    address: record.address,
    municipality: record.municipality,
    owner1: record.owner1,
    owner2: record.owner2,
    residentialUnits: record.residentialUnits,
    assessedValue: record.totalValue,
    sourceUrl: sourceUrl ?? record.sourceUrl ?? 'https://services3.arcgis.com/SP47Tddf7RK32lBU/arcgis/rest/services/Bucks_County_Parcels/FeatureServer/0',
    sourceYear: record.sourceYear,
  }, observedAt);
}
