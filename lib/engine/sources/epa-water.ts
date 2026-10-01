/** EPA Community Water System service-area boundaries: which utility serves a coordinate. */
import { titleCase, toInt, trimOrNull } from '../text';
import type { SourceInfo } from '../types';
import { arcgisQuery, type FetchCtx } from './common';

export const epaWater: SourceInfo = {
  id: 'epa-water',
  name: 'EPA Community Water System Boundaries',
  kind: 'enrichment',
  coverage: ['US'],
  coverageLabel: 'Nationwide',
  capabilities: ['water_utility', 'pwsid', 'population_served'],
  description: 'Service-area polygons for community water systems: identifies the water utility (PWSID) serving each building.',
  homepage: 'https://www.epa.gov/ground-water-and-drinking-water/community-water-system-service-area-boundaries',
  verified: 'live',
};

export const EPA_LAYER = 'https://services.arcgis.com/cJ9YHowT8TU7DUyn/ArcGIS/rest/services/Water_System_Boundaries/FeatureServer/0';

export type WaterSystem = { pwsid: string; name: string; population: number | null; connections: number | null; url: string };

export function parseWaterSystems(features: { attributes: Record<string, unknown> }[], url: string): WaterSystem[] {
  return features
    .map(({ attributes: a }) => ({
      pwsid: String(a.PWSID ?? ''),
      name: titleCase(String(a.PWS_Name ?? '')),
      population: toInt(a.Population_Served_Count),
      connections: toInt(a.Service_Connections_Count),
      url,
    }))
    .filter((w) => w.pwsid && trimOrNull(w.name))
    // Overlapping polygons (wholesale + retail): prefer the larger retail system.
    .sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
}

export async function waterSystemAt(lat: number, lon: number, ctx: FetchCtx): Promise<WaterSystem | null> {
  const { features, url } = await arcgisQuery(epaWater, EPA_LAYER, {
    geometry: `${lon.toFixed(5)},${lat.toFixed(5)}`,
    geometryType: 'esriGeometryPoint',
    inSR: 4326,
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'PWSID,PWS_Name,Population_Served_Count,Service_Connections_Count',
    returnGeometry: false,
  }, ctx, { ttlMs: 60 * 24 * 3_600_000, timeoutMs: 12_000 });
  return parseWaterSystems(features, url)[0] ?? null;
}
