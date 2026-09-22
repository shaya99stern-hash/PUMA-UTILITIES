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

    const queries = [
      `real estate owner operator self managed portfolio ${minBuildings} ${maxBuildings} buildings ${geography}`,
      `multifamily owner operator owns manages properties portfolio ${geography}`,
      `commercial real estate principal owner manages portfolio properties ${geography}`,
    ];
    const responses = await Promise.all(queries.map((query) =>
      searchWeb(query, { limit: Math.min(24, count * 3), signal: request.signal })
    ));

    const byHost = new Map<string, { name: string; website: string; snippet?: string; sourceUrl: string; score: number; hits: number }>();
    for (const item of responses.flatMap((response) => response.results)) {
      let url: URL;
      try { url = new URL(item.url); } catch { continue; }
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (DIRECTORY_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) continue;
      const text = `${item.title} ${item.snippet ?? ''}`.toLowerCase();
      const positive = [
        /owner[- ]?operator|owner and operator/.test(text),
        /owns? and manages?|acquires?.{0,40}owns?.{0,40}manages?/.test(text),
        /portfolio|properties|buildings|communities/.test(text),
        /multifamily|commercial real estate|property management/.test(text),
      ].filter(Boolean).length;
      const negative = /reit|fortune 500|global real estate|thousands of properties|nationwide platform/.test(text) ? 1 : 0;
      const existing = byHost.get(host);
      const score = positive * 0.12 - negative * 0.1;
      const candidate = {
        name: item.title.split(/\s+[|–—-]\s+/)[0]?.trim() || host,
        website: url.origin,
        snippet: item.snippet,
        sourceUrl: item.url,
        score: (existing?.score ?? 0) + score,
        hits: (existing?.hits ?? 0) + 1,
      };
      byHost.set(host, existing ? {
        ...candidate,
        name: existing.name,
        website: existing.website,
        sourceUrl: existing.sourceUrl,
        snippet: existing.snippet ?? candidate.snippet,
      } : candidate);
    }

    const candidates = [...byHost.values()]
      .sort((left, right) => (right.score + right.hits * 0.05) - (left.score + left.hits * 0.05))
      .slice(0, count)
      .map((candidate) => ({
        name: candidate.name,
        website: candidate.website,
        snippet: candidate.snippet,
        sourceUrl: candidate.sourceUrl,
        confidence: Math.max(0.35, Math.min(0.86, 0.46 + candidate.score + Math.min(0.15, candidate.hits * 0.05))),
      }));

    return NextResponse.json({
      query: queries.join(' | '),
      queries,
      candidates,
      note: 'Discovery uses multiple owner/operator query angles and ranks repeated first-party domains. Candidates remain unqualified until deep research verifies portfolio, ownership/management, contacts, and utilities.',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lead discovery failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}
