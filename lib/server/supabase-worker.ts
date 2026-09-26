import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { PUMA_SUPABASE_PUBLISHABLE_KEY, PUMA_SUPABASE_URL } from '../supabase-config';

export function createWorkerSupabase(workerToken: string) {
  const token = workerToken.trim();
  if (token.length < 32) throw new Error('PUMA_WORKER_TOKEN_INVALID');

  return createClient(PUMA_SUPABASE_URL, PUMA_SUPABASE_PUBLISHABLE_KEY, {
    global: {
      headers: {
        'x-puma-worker-token': token,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
