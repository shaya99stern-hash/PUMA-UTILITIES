import { NextResponse } from 'next/server';
import { aggregateDiscoveryCandidates, parseDiscoveryGeographies, type DiscoverySearchHit } from '@/lib/research/discovery-ranking';
import { searchWeb } from '@/lib/research/web-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const MAX_BODY_BYTES = 8_192;

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
    const input = JSON.parse(raw) as Record<string, unknown>;
    const markets = parseDiscoveryGeographies(typeof input.geography === 'string' ? input.geography : 'NJ');
    const minBuildings = bounded(input.minBuildings, 20, 1, 1000);
    const maxBuildings = bounded(input.maxBuildings, 100, minBuildings, 5000);
    const count = bounded(input.count, 10, 1, 20);

    const querySpecs = markets.flatMap((geography) => [
      {
        geography,
        query: `real estate owner operator self managed portfolio ${minBuildings} ${maxBuildings} buildings ${geography}`,
      },
      {
        geography,
        query: `multifamily commercial real estate owner principal owns manages portfolio properties ${geography}`,
      },
    ]);

    const responses = await Promise.all(querySpecs.map(async ({ geography, query }) => ({
      geography,
      query,
      response: await searchWeb(query, { limit: Math.min(20, Math.max(10, count * 2)), signal: request.signal }),
    })));

    const hits: DiscoverySearchHit[] = responses.flatMap(({ geography, response }) =>
      response.results.map((result) => ({ geography, result }))
    );
    const candidates = aggregateDiscoveryCandidates(hits, count);

    return NextResponse.json({
      markets,
      queries: responses.map((item) => item.query),
      candidates,
      note: 'Discovery ranks repeated first-party domains across the selected markets. Discovery score is only a routing signal; deep research still verifies portfolio size, ownership/management, contacts, property facts, utilities and rates.',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lead discovery failed.';
    const status = /two-letter state|at most 5/i.test(message) ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}
