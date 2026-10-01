import { pumpJob } from '@/lib/engine/jobs';
import { requireMember } from '@/lib/server/auth';
import { sql } from '@/lib/server/db';
import { ApiError, json, route } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Advances research while the page is open (the cron tick continues it otherwise). */
export const POST = route(async (_request, { params }: { params: Promise<{ runId: string }> }) => {
  const ctx = await requireMember();
  const { runId } = await params;
  const [job] = await sql()`select id from research_jobs where id = ${runId} and workspace_id = ${ctx.workspaceId}`;
  if (!job) throw new ApiError(404, 'Search not found.');
  const result = await pumpJob(runId, 40_000);
  return json(result ?? { status: 'unknown', progress: 0 });
});
