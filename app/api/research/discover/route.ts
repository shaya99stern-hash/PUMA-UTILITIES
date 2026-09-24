import { NextResponse } from 'next/server';
import { discoverCompanies } from '@/lib/research/discovery-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const MAX_BODY_BYTES = 8_192;

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
    const input = JSON.parse(raw) as Record<string, unknown>;

    const outcome = await discoverCompanies({
      geography: typeof input.geography === 'string' ? input.geography : 'NJ',
      minBuildings: input.minBuildings as number | undefined,
      maxBuildings: input.maxBuildings as number | undefined,
      count: input.count as number | undefined,
    }, { signal: request.signal });

    if (outcome.allFailed) {
      return NextResponse.json({
        error: 'Lead discovery sources are temporarily unavailable.',
        warnings: outcome.warnings,
        diagnostics: outcome.diagnostics,
      }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }

    return NextResponse.json({
      ...outcome,
      note: 'Discovery ranks repeated first-party domains across the selected markets. Discovery score is only a routing signal; deep research still verifies portfolio size, ownership/management, contacts, property facts, utilities and rates.',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lead discovery failed.';
    const status = /two-letter state|at most 5/i.test(message) ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
