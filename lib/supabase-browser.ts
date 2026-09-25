'use client';

import { createBrowserClient } from '@supabase/ssr';
import { PUMA_SUPABASE_PUBLISHABLE_KEY, PUMA_SUPABASE_URL } from './supabase-config';

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export function createBrowserSupabase() {
  browserClient ??= createBrowserClient(PUMA_SUPABASE_URL, PUMA_SUPABASE_PUBLISHABLE_KEY);
  return browserClient;
}