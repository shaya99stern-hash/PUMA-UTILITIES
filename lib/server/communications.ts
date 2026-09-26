import 'server-only';

import { requireWorkspace } from './current-workspace';
import { PUMA_SUPABASE_URL } from '../supabase-config';

const COMMUNICATIONS_URL = `${PUMA_SUPABASE_URL}/functions/v1/puma-communications`;

export async function invokeCommunications(action: string, payload: Record<string, unknown> = {}) {
  const { supabase, user, workspace } = await requireWorkspace();
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error('AUTH_UNAVAILABLE');

  const response = await fetch(COMMUNICATIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, workspaceId: workspace.id, ...payload }),
    cache: 'no-store',
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok || body.ok !== true) throw new Error(typeof body.error === 'string' ? body.error : 'Communications service unavailable.');
  return { body, supabase, user, workspace };
}
