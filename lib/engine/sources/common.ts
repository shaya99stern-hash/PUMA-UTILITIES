import { fetchJson, SourceError, type FetchOptions } from '../http';
import type { Provenance, SourceInfo } from '../types';

export type FetchCtx = { deadline?: number };

export function provenance(source: Pick<SourceInfo, 'id' | 'name'>, url: string, extra?: Partial<Provenance>): Provenance {
  return { sourceId: source.id, sourceName: source.name, url, retrievedAt: new Date().toISOString(), method: 'api', ...extra };
}

/** SoQL string literal. */
export function soql(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function socrataUrl(resource: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(resource);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  return url.toString();
}

export async function socrataRows<T = Record<string, string>>(
  source: Pick<SourceInfo, 'id'>,
  resource: string,
  params: Record<string, string | number | undefined>,
  ctx: FetchCtx,
  opts: Partial<FetchOptions> = {},
): Promise<{ rows: T[]; url: string }> {
  const url = socrataUrl(resource, params);
  const headers: Record<string, string> = {};
  if (process.env.SOCRATA_APP_TOKEN) headers['X-App-Token'] = process.env.SOCRATA_APP_TOKEN;
  const { data } = await fetchJson<unknown>({ sourceId: source.id, url, deadline: ctx.deadline, headers, timeoutMs: 20_000, ...opts });
  if (!Array.isArray(data)) {
    const message = (data as { message?: string })?.message ?? 'Unexpected Socrata response';
    throw new SourceError(source.id, 'parse', message);
  }
  return { rows: data as T[], url };
}

export type ArcgisFeature<A = Record<string, unknown>> = { attributes: A; geometry?: { x?: number; y?: number; rings?: number[][][] } };
export type ArcgisResponse<A = Record<string, unknown>> = { features?: ArcgisFeature<A>[]; exceededTransferLimit?: boolean; error?: { code?: number; message?: string; details?: string[] }; count?: number };

export function arcgisUrl(layer: string, params: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(`${layer.replace(/\/$/, '')}/query`);
  url.searchParams.set('f', 'json');
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  return url.toString();
}

export async function arcgisQuery<A = Record<string, unknown>>(
  source: Pick<SourceInfo, 'id'>,
  layer: string,
  params: Record<string, string | number | boolean | undefined>,
  ctx: FetchCtx,
  opts: Partial<FetchOptions> = {},
): Promise<{ features: ArcgisFeature<A>[]; exceeded: boolean; url: string }> {
  const url = arcgisUrl(layer, params);
  const { data } = await fetchJson<ArcgisResponse<A>>({ sourceId: source.id, url, deadline: ctx.deadline, timeoutMs: 20_000, ...opts });
  if (data.error) throw new SourceError(source.id, 'http', `ArcGIS error ${data.error.code ?? ''}: ${data.error.message ?? ''} ${(data.error.details ?? []).join(' ')}`.trim());
  return { features: data.features ?? [], exceeded: Boolean(data.exceededTransferLimit), url };
}

/** ArcGIS SQL string literal. */
export function sqlLit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Average of polygon ring vertices (good enough for a parcel centroid). */
export function ringCentroid(rings: number[][][] | undefined): { lat: number; lon: number } | null {
  const pts = rings?.[0];
  if (!pts?.length) return null;
  let x = 0;
  let y = 0;
  const n = pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] ? pts.length - 1 : pts.length;
  for (let i = 0; i < n; i += 1) {
    x += pts[i][0];
    y += pts[i][1];
  }
  return { lon: x / n, lat: y / n };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
