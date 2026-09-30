import 'server-only';
import { cache } from 'react';
import { devAuthUserId, loginRequired } from '@/lib/supabase/config';
import { supabaseServer } from '@/lib/supabase/server';
import { sql } from './db';
import { ApiError } from './http';

export type SessionUser = { id: string; email: string | null };
export type MemberContext = {
  /** Null when the app runs in open mode and nobody is signed in. */
  userId: string | null;
  email: string | null;
  workspaceId: string;
  role: 'owner' | 'admin' | 'member';
};

/** Resolves the signed-in user, if any (cached per request). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const devId = devAuthUserId();
  if (devId) return { id: devId, email: 'dev@puma.local' };
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  } catch {
    return null;
  }
});

/** The shared workspace used when sign-in is not required. Created on first use. */
const getDefaultWorkspaceId = cache(async (): Promise<string> => {
  const db = sql();
  const existing = await db<{ id: string }[]>`select id from workspaces order by created_at limit 1`;
  if (existing[0]) return existing[0].id;
  const created = await db<{ id: string }[]>`insert into workspaces(name) values ('Puma Utilities') returning id`;
  return created[0].id;
});

/** Resolves the workspace for this request (member workspace, or the shared one in open mode). */
export const getMemberContext = cache(async (): Promise<MemberContext | null> => {
  const user = await getSessionUser();
  if (user) {
    const rows = await sql()<{ workspace_id: string; role: MemberContext['role'] }[]>`
      select workspace_id, role from workspace_members where user_id = ${user.id} order by created_at limit 1`;
    if (rows[0]) return { userId: user.id, email: user.email, workspaceId: rows[0].workspace_id, role: rows[0].role };
  }
  if (loginRequired()) return null;
  return { userId: user?.id ?? null, email: user?.email ?? null, workspaceId: await getDefaultWorkspaceId(), role: 'owner' };
});

/** Use at the top of every data route handler. */
export async function requireMember(minRole: 'member' | 'admin' | 'owner' = 'member'): Promise<MemberContext> {
  const ctx = await getMemberContext();
  if (!ctx) {
    const user = await getSessionUser();
    throw user
      ? new ApiError(403, 'Your account is not a member of a Puma workspace yet.')
      : new ApiError(401, 'Sign in to continue.');
  }
  const rank = { member: 0, admin: 1, owner: 2 } as const;
  if (rank[ctx.role] < rank[minRole]) throw new ApiError(403, 'You do not have permission to do that.');
  return ctx;
}
