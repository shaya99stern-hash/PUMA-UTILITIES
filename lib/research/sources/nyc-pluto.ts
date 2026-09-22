import { addClaim, addEvidence } from '../graph';
import type { ResearchGraph } from '../types';

const PLUTO_API = 'https://data.cityofnewyork.us/resource/64uk-42ks.json';
const PLUTO_DATASET = 'https://data.cityofnewyork.us/City-Government/Primary-Land-Use-Tax-Lot-Output-PLUTO-/64uk-42ks';

export type NycPlutoRecord = {
  bbl?: string;
  borough?: string;
  address?: string;
  unitsres?: string;
  bldgarea?: string;
  condono?: string;
};

export function canonicalNycBbl(borough: string, block: string, lot: string): string | undefined {
  if (!/^[1-5]$/.test(borough)) return undefined;
  if (!/^\d{1,5}$/.test(block) || !/^\d{1,4}$/.test(lot)) return undefined;
  return borough + block.padStart(5, '0') + lot.padStart(4, '0');
}

export async function lookupNycPlutoByBbl(
  borough: string,
  block: string,
  lot: string,
  signal?: AbortSignal,
): Promise<NycPlutoRecord | undefined> {
  const bbl = canonicalNycBbl(borough, block, lot);
  if (!bbl) return undefined;
  const url = new URL(PLUTO_API);
  url.searchParams.set('$select', 'bbl,borough,address,unitsres,bldgarea,condono');
  url.searchParams.set('$where', `bbl=${bbl}`);
  url.searchParams.set('$limit', '2');

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'PumaUtilitiesResearch/1.4 public property research',
    },
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(`NYC PLUTO returned ${response.status}.`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error('NYC PLUTO returned an unexpected response.');
  const rows = (payload as NycPlutoRecord[]).filter((row) => normalizeBbl(row.bbl) === bbl);
  return rows.length === 1 ? rows[0] : undefined;
}

export function ingestNycPluto(
  graph: ResearchGraph,
  propertyId: string,
  record: NycPlutoRecord,
  sourceUrl = PLUTO_DATASET,
  observedAt = new Date().toISOString(),
): void {
  const property = graph.entities.find((entity) => entity.id === propertyId && entity.kind === 'property');
  if (!property) throw new Error('PLUTO target property was not found.');

  const bbl = normalizeBbl(record.bbl);
  const evidenceId = `evidence:pluto:${bbl ?? token(propertyId)}`;
  addEvidence(graph, {
    id: evidenceId,
    sourceId: 'nyc-pluto',
    url: sourceUrl,
    observedAt,
    authority: 'official',
    confidence: 0.96,
    excerpt: [
      bbl ? `BBL ${bbl}` : undefined,
      record.address ? `address ${record.address}` : undefined,
      positiveInteger(record.unitsres) ? `${positiveInteger(record.unitsres)} residential units` : undefined,
      positiveInteger(record.bldgarea) ? `${positiveInteger(record.bldgarea)} sq ft building area` : undefined,
      isCondo(record.condono) ? 'condominium area semantics' : undefined,
    ].filter(Boolean).join(' · ').slice(0, 700),
  });

  const units = positiveInteger(record.unitsres);
  if (units !== undefined && units <= 100_000) {
    addClaim(graph, {
      id: `claim:${propertyId}:units:pluto`,
      subjectId: propertyId,
      fact: 'property.units',
      value: units,
      state: 'VERIFIED',
      confidence: 0.97,
      evidenceIds: [evidenceId],
      observedAt,
    });
  }

  const area = positiveInteger(record.bldgarea);
  if (area !== undefined && area <= 500_000_000 && !isCondo(record.condono)) {
    addClaim(graph, {
      id: `claim:${propertyId}:gross-area:pluto`,
      subjectId: propertyId,
      fact: 'property.grossSquareFeet',
      value: area,
      state: 'VERIFIED',
      confidence: 0.95,
      evidenceIds: [evidenceId],
      observedAt,
    });
  }
}

function normalizeBbl(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value).toString().padStart(10, '0');
  if (typeof value !== 'string') return undefined;
  const digits = value.replace(/\D/g, '');
  return digits.length === 10 ? digits : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/,/g, '')) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed);
}

function isCondo(value: unknown): boolean {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/,/g, '')) : NaN;
  return Number.isFinite(parsed) && parsed > 0;
}

function token(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
