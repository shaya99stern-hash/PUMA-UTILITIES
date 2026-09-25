import { NextResponse } from 'next/server';
import { requireWorkspace } from '@/lib/server/current-workspace';
import { getResearchJobStatus } from '@/lib/server/research-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await context.params;
    const { supabase, workspace } = await requireWorkspace();
    const status = await getResearchJobStatus(supabase, workspace.id, runId);
    return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to read research job.';
    if (message === 'AUTH_REQUIRED') return NextResponse.json({ error: 'Sign in to view research.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    if (message === 'RESEARCH_RUN_NOT_FOUND') return NextResponse.json({ error: 'Research run was not found.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ error: message }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
