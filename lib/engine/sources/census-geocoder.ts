/** US Census Bureau geocoder (one-line address -> coordinates). Used only when a dataset has no coordinates. */
import { fetchJson } from '../http';
import type { SourceInfo } from '../types';
import type { FetchCtx } from './common';

export const censusGeocoder: SourceInfo = {
  id: 'census-geocoder',
  name: 'US Census Geocoder',
  kind: 'enrichment',
  coverage: ['US'],
  coverageLabel: 'Nationwide',
  capabilities: ['coordinates'],
  description: 'Free address geocoding from the Census Bureau, used to place buildings that lack coordinates.',
  homepage: 'https://geocoding.geo.census.gov/geocoder/',
  // The DB host could not complete TLS to this endpoint; the app falls back to dataset coordinates.
  verified: 'unverified',
};

type CensusResponse = { result?: { addressMatches?: { coordinates?: { x: number; y: number }; matchedAddress?: string }[] } };

export function parseCensusMatch(data: CensusResponse): { lat: number; lon: number; matched: string | null } | null {
  const m = data.result?.addressMatches?.[0];
  if (!m?.coordinates) return null;
  return { lat: m.coordinates.y, lon: m.coordinates.x, matched: m.matchedAddress ?? null };
}

export async function geocodeAddress(address: string, ctx: FetchCtx) {
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=${encodeURIComponent(address)}`;
  const { data } = await fetchJson<CensusResponse>({ sourceId: censusGeocoder.id, url, deadline: ctx.deadline, timeoutMs: 8000, retries: 1, ttlMs: 90 * 24 * 3_600_000 });
  return parseCensusMatch(data);
}
