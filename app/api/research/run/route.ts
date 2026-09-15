import { NextResponse } from 'next/server';
import { createResearchGraph, upsertEntity } from '@/lib/research/graph';
import { runResearch } from '@/lib/research/runner';
import type { ResearchEntityKind } from '@/lib/research/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BODY_BYTES = 16_384;
const ALLOWED_KINDS = new Set<ResearchEntityKind>(['company', 'property', 'person', 'utility', 'organization']);

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > MAX_BODY_BYTES) return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
    const input = JSON.parse(raw) as Record<string, unknown>;

    const label = typeof input.label === 'string' ? input.label.trim() : '';
    const geography = typeof input.geography === 'string' ? input.geography.trim().toUpperCase() : '';
    const requestedKind = typeof input.kind === 'string' ? input.kind : 'company';
    if (label.length < 2 || label.length > 180) return invalid('Research label must be 2–180 characters.');
    if (geography && !/^[A-Z]{2}$/.test(geography)) return invalid('Geography must be a two-letter state code.');
    if (!ALLOWED_KINDS.has(requestedKind as ResearchEntityKind)) return invalid('Unsupported research entity kind.');

    const graph = createResearchGraph();
    const rootEntityId = `seed:${slug(requestedKind)}:${slug(label)}`;
    upsertEntity(graph, {
      id: rootEntityId,
      kind: requestedKind as ResearchEntityKind,
      label,
      geography: geography || undefined,
    });

    const result = await runResearch(graph, rootEntityId, {
      maxTasks: boundedInteger(input.maxTasks, 24, 1, 60),
      maxDepth: boundedInteger(input.maxDepth, 3, 0, 5),
      concurrency: boundedInteger(input.concurrency, 4, 1, 8),
      perNeed: boundedInteger(input.perNeed, 3, 1, 6),
      targetCompleteness: boundedNumber(input.targetCompleteness, 0.82, 0.25, 1),
      signal: request.signal,
    });

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof SyntaxError) return invalid('Request body must be valid JSON.');
    const message = error instanceof Error ? error.message : 'Research run failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function invalid(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'entity';
}
