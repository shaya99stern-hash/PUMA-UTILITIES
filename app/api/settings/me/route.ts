import { requireMember } from '@/lib/server/auth';
import { sql } from '@/lib/server/db';
import { json, route } from '@/lib/server/http';

export const runtime = 'nodejs';

/** Who is using the app right now (used by the shell and settings). Sign-in is optional. */
export const GET = route(async () => {
  const ctx = await requireMember();
  const db = sql();
  const [workspace] = await db<{ name: string }[]>`select name from workspaces where id = ${ctx.workspaceId}`;
  let profile: { full_name: string | null; title: string | null; phone: string | null } | undefined;
  if (ctx.userId) {
    [profile] = await db<{ full_name: string | null; title: string | null; phone: string | null }[]>`
      select full_name, title, phone from profiles where user_id = ${ctx.userId}`;
  }
  return json({
    signedIn: !!ctx.userId,
    userId: ctx.userId,
    email: ctx.email,
    name: profile?.full_name ?? null,
    title: profile?.title ?? null,
    role: ctx.role,
    workspaceId: ctx.workspaceId,
    workspaceName: workspace?.name ?? 'Puma Utilities',
  });
});
