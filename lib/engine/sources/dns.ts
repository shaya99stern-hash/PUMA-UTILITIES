/** DNS over HTTPS (dns.google): MX / A checks for domains and inferred email patterns. */
import { fetchJson } from '../http';
import type { SourceInfo } from '../types';
import type { FetchCtx } from './common';

export const dnsGoogle: SourceInfo = {
  id: 'dns-google',
  name: 'Google Public DNS (DoH)',
  kind: 'enrichment',
  coverage: ['WEB'],
  coverageLabel: 'Internet',
  capabilities: ['mx_check', 'domain_exists'],
  description: 'Checks that a company domain exists and accepts email (MX) before suggesting inferred addresses.',
  homepage: 'https://developers.google.com/speed/public-dns/docs/doh/json',
  verified: 'live',
};

type DohResponse = { Status?: number; Answer?: { type: number; data: string }[] };

export function parseDoh(data: DohResponse, type: number): string[] {
  if (data.Status !== 0) return [];
  return (data.Answer ?? []).filter((a) => a.type === type).map((a) => a.data.replace(/\.$/, ''));
}

export async function resolveDns(domain: string, type: 'MX' | 'A', ctx: FetchCtx): Promise<string[]> {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`;
  const { data } = await fetchJson<DohResponse>({ sourceId: dnsGoogle.id, url, deadline: ctx.deadline, timeoutMs: 5000, retries: 1, ttlMs: 7 * 24 * 3_600_000 });
  return parseDoh(data, type === 'MX' ? 15 : 1);
}

export async function hasMx(domain: string, ctx: FetchCtx): Promise<boolean> {
  try {
    return (await resolveDns(domain, 'MX', ctx)).length > 0;
  } catch {
    return false;
  }
}
