import { z } from 'zod';
import { requireMember } from '@/lib/server/auth';
import { sql } from '@/lib/server/db';
import { ApiError, json, readJson, route } from '@/lib/server/http';

export const runtime = 'nodejs';

const schema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  role: z.enum(['admin', 'member']).default('member'),
});

/** Creates (or refreshes) an invitation. The invite link is /login?invite=<token>. */
export const POST = route(async (request) => {
  const ctx = await requireMember('admin');
  const body = await readJson(request, schema);
  const db = sql();
  const existingMember = await db`
    select 1 from workspace_members m join profiles p on p.user_id = m.user_id
    where m.workspace_id = ${ctx.workspaceId} and p.email = ${body.email} limit 1`;
  if (existingMember.length) throw new ApiError(409, `${body.email} is already a member of this workspace.`);
  await db`
    delete from invitations where workspace_id = ${ctx.workspaceId} and email = ${body.email} and accepted_at is null`;
  const [row] = await db<{ id: string; email: string; role: string; token: string; expires_at: string; created_at: string }[]>`
    insert into invitations (workspace_id, email, role, invited_by)
    values (${ctx.workspaceId}, ${body.email}, ${body.role ?? 'member'}, ${ctx.userId})
    returning id, email::text as email, role, token, expires_at, created_at`;
  return json({ invitation: row, path: `/login?invite=${row.token}` }, 201);
});
