import { requireMember } from '@/lib/server/auth';
import { sql } from '@/lib/server/db';
import { json, route } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export const POST = route(async (_request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireMember();
  const { id } = await params;
  await sql()`update lead_candidates set status = 'dismissed' where id = ${id} and workspace_id = ${ctx.workspaceId}`;
  return json({ ok: true });
});
