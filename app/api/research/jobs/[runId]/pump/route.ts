import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireWorkspace } from '@/lib/server/current-workspace';
import { createAdminSupabase } from '@/lib/server/supabase-admin';
import { getResearchJobStatus, processResearchJob } from '@/lib/server/research-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(_request: Request, context: { params: Promise<{ runId: string }> }) {
  let admin: ReturnType<typeof createAdminSupabase> | null = null;
  let workerName = '';
  let claimed = false;

  try {
    const { runId } = await context.params;
    const { supabase, workspace } = await requireWorkspace();

    // Authorize against the user's RLS-scoped client before elevating to the worker client.
    const current = await getResearchJobStatus(supabase, workspace.id, runId);

    admin = createAdminSupabase();
    workerName = `web:${randomUUID()}`;
    const lease = await admin.rpc('claim_research_worker_tick', {
      worker_name: workerName,
      lease_seconds: 45,
    });
    if (lease.error) throw new Error(`Unable to coordinate research worker: ${lease.error.message}`);
    claimed = lease.data === true;

    // The autonomous cron worker may already be processing another task. The browser pump
    // is only an accelerator now; return saved progress instead of racing the background worker.
    if (!claimed) {
      return NextResponse.json({ ...current, busy: true }, { status: 202, headers: NO_STORE });
    }

    const status = await processResearchJob(admin, runId, workerName);
    return NextResponse.json(status, { headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to continue research.';
    if (message === 'AUTH_REQUIRED') return NextResponse.json({ error: 'Sign in to continue research.' }, { status: 401, headers: NO_STORE });
    if (message === 'RESEARCH_RUN_NOT_FOUND') return NextResponse.json({ error: 'Research run was not found.' }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ error: message }, { status: 502, headers: NO_STORE });
  } finally {
    if (admin && claimed && workerName) {
      const released = await admin.rpc('release_research_worker_tick', { worker_name: workerName });
      if (released.error) console.error('research browser worker lease release failed', released.error.message);
    }
  }
}
