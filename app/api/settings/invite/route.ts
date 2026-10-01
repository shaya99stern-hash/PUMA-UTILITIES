import { sql } from '@/lib/server/db';
import { json, route, searchParams } from '@/lib/server/http';

export const runtime = 'nodejs';

/** Public lookup used by /login?invite=<token> to prefill the invited email. */
export const GET = route(async (request) => {
  const token = (searchParams(request).get('token') ?? '').trim();
  if (!/^[0-9a-f]{16,128}$/i.test(token)) return json({ valid: false });
  const [row] = await sql()<{ email: string; role: string; expires_at: Date; accepted_at: Date | null; workspace_name: string }[]>`
    select i.email::text as email, i.role, i.expires_at, i.accepted_at, w.name as workspace_name
    from invitations i join workspaces w on w.id = i.workspace_id
    where i.token = ${token} limit 1`;
  if (!row) return json({ valid: false });
  const expired = row.expires_at < new Date();
  return json({
    valid: !expired && !row.accepted_at,
    accepted: !!row.accepted_at,
    expired,
    email: row.email,
    role: row.role,
    workspaceName: row.workspace_name,
  });
});
