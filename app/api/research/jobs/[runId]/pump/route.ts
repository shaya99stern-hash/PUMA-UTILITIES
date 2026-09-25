import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireWorkspace } from '@/lib/server/current-workspace';
import { createAdminSupabase } from '@/lib/server/supabase-admin';
import { getResearchJobStatus, processResearchJob } from '@/lib/server/research-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export async function POST(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await context.params;
    const { supabase, workspace } = await requireWorkspace();

    // Authorize against the user's RLS-scoped client before elevating to the worker client.
    await getResearchJobStatus(supabase, workspace.id, runId);

    const admin = createAdminSupabase();
    const status = await processResearchJob(admin, runId, `web:${randomUUID()}`);
    return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to continue research.';
    if (message === 'AUTH_REQUIRED') return NextResponse.json({ error: 'Sign in to continue research.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    if (message === 'RESEARCH_RUN_NOT_FOUND') return NextResponse.json({ error: 'Research run was not found.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ error: message }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
