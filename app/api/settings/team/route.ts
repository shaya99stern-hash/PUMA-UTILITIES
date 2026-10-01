import { requireMember } from '@/lib/server/auth';
import { sql } from '@/lib/server/db';
import { json, route } from '@/lib/server/http';

export const runtime = 'nodejs';

/** Workspace members and pending invitations. */
export const GET = route(async () => {
  const ctx = await requireMember();
  const db = sql();
  const [members, invitations] = await Promise.all([
    db<{ user_id: string; role: string; created_at: string; email: string | null; full_name: string | null; title: string | null }[]>`
      select m.user_id, m.role, m.created_at, p.email::text as email, p.full_name, p.title
      from workspace_members m left join profiles p on p.user_id = m.user_id
      where m.workspace_id = ${ctx.workspaceId}
      order by (m.role = 'owner') desc, m.created_at`,
    db<{ id: string; email: string; role: string; token: string; expires_at: string; accepted_at: string | null; created_at: string }[]>`
      select id, email::text as email, role, token, expires_at, accepted_at, created_at
      from invitations
      where workspace_id = ${ctx.workspaceId} and accepted_at is null
      order by created_at desc`,
  ]);
  const canManage = ctx.role === 'owner' || ctx.role === 'admin';
  return json({
    signedIn: !!ctx.userId,
    currentUserId: ctx.userId,
    canManage,
    members,
    invitations: invitations.map((i) => ({ ...i, token: canManage ? i.token : null, expired: new Date(i.expires_at) < new Date() })),
  });
});
