import { NextResponse } from 'next/server';
import { searchWeb } from '@/lib/research/web-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_BODY_BYTES = 8_192;
const DIRECTORY_HOSTS = ['linkedin.com','facebook.com','instagram.com','yelp.com','yellowpages.com','zillow.com','apartments.com','loopnet.com','crunchbase.com'];

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
    const input = JSON.parse(raw) as Record<string, unknown>;
    const geography = typeof input.geography === 'string' ? input.geography.trim().toUpperCase() : 'NJ';
    const minBuildings = bounded(input.minBuildings, 20, 1, 1000);
    const maxBuildings = bounded(input.maxBuildings, 100, minBuildings, 5000);
    const count = bounded(input.count, 10, 1, 20);
    if (!/^[A-Z]{2}$/.test(geography)) return NextResponse.json({ error: 'Geography must be a two-letter state code.' }, { status: 400 });

    const query = `real estate owner operator property management self managed portfolio ${minBuildings} ${maxBuildings} buildings ${geography}`;
    const response = await searchWeb(query, { limit: Math.min(30, count * 3), signal: request.signal });
    const seen = new Set<string>();
    const candidates: Array<{ name: string; website: string; snippet?: string; sourceUrl: string; confidence: number }> = [];

    for (const item of response.results) {
      let url: URL;
      try { url = new URL(item.url); } catch { continue; }
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (DIRECTORY_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) continue;
      if (seen.has(host)) continue;
      seen.add(host);
      candidates.push({
        name: item.title.split(/\s+[|–—-]\s+/)[0]?.trim() || host,
        website: url.origin,
        snippet: item.snippet,
        sourceUrl: item.url,
        confidence: Math.max(0.35, 0.62 - Math.min(0.2, Math.max(0, seen.size - 1) * 0.02)),
      });
      if (candidates.length >= count) break;
    }

    return NextResponse.json({
      query,
      candidates,
      note: 'These are discovery candidates, not qualified prospects. Run deep research before saving.',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lead discovery failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}
