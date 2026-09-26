import 'server-only';

import { ensurePumaSession } from '../anonymous-auth';
import { getDeviceBootstrapSession } from './device-session';
import { createServerSupabase } from './supabase-server';

export async function requireUser() {
  const supabase = await createServerSupabase();
  const user = await ensurePumaSession(supabase, getDeviceBootstrapSession);
  return { supabase, user };
}

export async function requireWorkspace() {
  const { supabase, user } = await requireUser();
  const existing = await supabase
    .from('workspaces')
    .select('id, owner_user_id, name, local_import_completed_at')
    .eq('owner_user_id', user.id)
    .maybeSingle();

  if (existing.error) throw new Error(`Unable to load Puma workspace: ${existing.error.message}`);
  if (existing.data) return { supabase, user, workspace: existing.data };

  const created = await supabase
    .from('workspaces')
    .insert({ owner_user_id: user.id, name: 'Puma Utilities' })
    .select('id, owner_user_id, name, local_import_completed_at')
    .single();

  if (created.error || !created.data) {
    throw new Error(`Unable to initialize Puma workspace: ${created.error?.message ?? 'unknown error'}`);
  }

  return { supabase, user, workspace: created.data };
}
