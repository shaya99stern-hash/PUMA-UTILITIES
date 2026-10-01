import { requireMember } from '@/lib/server/auth';
import { sql } from '@/lib/server/db';
import { json, route } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export const POST = route(async (_request, { params }: { params: Promise<{ runId: string }> }) => {
  const ctx = await requireMember();
  const { runId } = await params;
  await sql()`update research_jobs set status = 'canceled', stage = 'Canceled', finished_at = now(), lease_until = null where id = ${runId} and workspace_id = ${ctx.workspaceId} and status in ('queued','running')`;
  return json({ ok: true });
});
