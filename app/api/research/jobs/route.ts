import { NextResponse } from 'next/server';
import { isPublicHttpUrl } from '@/lib/research/web-search';
import { requireWorkspace } from '@/lib/server/current-workspace';
import { createResearchJob } from '@/lib/server/research-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16_384;

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > MAX_BODY_BYTES) return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
    const input = JSON.parse(raw) as Record<string, unknown>;

    const label = typeof input.label === 'string' ? input.label.trim() : '';
    const geography = typeof input.geography === 'string' ? input.geography.trim().toUpperCase() : '';
    const website = typeof input.website === 'string' ? input.website.trim() : '';
    if (label.length < 2 || label.length > 180) return invalid('Company name must be 2–180 characters.');
    if (geography && !/^[A-Z]{2}$/.test(geography)) return invalid('Geography must be a two-letter state code.');
    if (website && !isPublicHttpUrl(website)) return invalid('Website must be a public HTTP(S) URL.');

    const { supabase, user, workspace } = await requireWorkspace();
    const job = await createResearchJob(supabase, workspace.id, user.id, {
      label,
      geography: geography || undefined,
      website: website || undefined,
      maxTasks: boundedInteger(input.maxTasks, 60, 1, 80),
      maxDepth: boundedInteger(input.maxDepth, 4, 0, 5),
      maxBudgetUnits: boundedNumber(input.maxBudgetUnits, 82, 5, 120),
      perNeed: boundedInteger(input.perNeed, 6, 1, 6),
      targetCompleteness: boundedNumber(input.targetCompleteness, 0.82, 0.25, 1),
    });

    return NextResponse.json(job, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof SyntaxError) return invalid('Request body must be valid JSON.');
    const message = error instanceof Error ? error.message : 'Unable to create research job.';
    if (message === 'AUTH_REQUIRED') return NextResponse.json({ error: 'Sign in to start research.' }, { status: 401 });
    return NextResponse.json({ error: message }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}

function invalid(message: string) {
  return NextResponse.json({ error: message }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
