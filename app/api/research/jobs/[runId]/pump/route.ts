import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireWorkspace } from '@/lib/server/current-workspace';
import { getResearchJobStatus, processResearchJob } from '@/lib/server/research-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(_request: Request, context: { params: Promise<{ runId: string }> }) {
  let releaseLease: (() => Promise<void>) | null = null;

  try {
    const { runId } = await context.params;
    const { supabase, workspace } = await requireWorkspace();

    // Authorization and all queue writes remain inside the signed-in workspace RLS scope.
    const current = await getResearchJobStatus(supabase, workspace.id, runId);
    const workerName = `web:${randomUUID()}`;
    const lease = await supabase.rpc('claim_research_browser_tick', {
      worker_name: workerName,
      target_run_id: runId,
      lease_seconds: 45,
    });
    if (lease.error) throw new Error(`Unable to coordinate research worker: ${lease.error.message}`);
    const claimed = lease.data === true;

    if (!claimed) {
      return NextResponse.json({ ...current, busy: true }, { status: 202, headers: NO_STORE });
    }

    releaseLease = async () => {
      const released = await supabase.rpc('release_research_browser_tick', {
        worker_name: workerName,
        target_run_id: runId,
      });
      if (released.error) console.error('research browser worker lease release failed', released.error.message);
    };

    const status = await processResearchJob(supabase, runId, workerName);
    return NextResponse.json(status, { headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to continue research.';
    if (message === 'AUTH_REQUIRED') return NextResponse.json({ error: 'Sign in to continue research.' }, { status: 401, headers: NO_STORE });
    if (message === 'RESEARCH_RUN_NOT_FOUND') return NextResponse.json({ error: 'Research run was not found.' }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ error: message }, { status: 502, headers: NO_STORE });
  } finally {
    if (releaseLease) await releaseLease();
  }
}
