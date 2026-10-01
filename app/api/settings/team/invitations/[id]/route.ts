import { requireMember } from '@/lib/server/auth';
import { sql } from '@/lib/server/db';
import { ApiError, json, route } from '@/lib/server/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** Revokes a pending invitation. */
export const DELETE = route<Ctx>(async (_request, context) => {
  const ctx = await requireMember('admin');
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(400, 'Invalid invitation id.');
  const rows = await sql()`
    delete from invitations where id = ${id} and workspace_id = ${ctx.workspaceId} and accepted_at is null returning id`;
  if (!rows.length) throw new ApiError(404, 'Invitation not found.');
  return json({ ok: true });
});
