import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { serverEnv } from './env';

export function createAdminSupabase() {
  const { url, serviceRoleKey } = serverEnv();
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
