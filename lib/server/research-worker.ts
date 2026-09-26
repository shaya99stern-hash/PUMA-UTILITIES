import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { processResearchJob } from './research-jobs';

type DbClient = SupabaseClient<any, any, any>;

export async function processNextResearchWork(admin: DbClient, workerName: string) {
  const next = await admin.rpc('next_research_run_for_worker');
  if (next.error) throw new Error(`Unable to inspect the research queue: ${next.error.message}`);

  const runId = typeof next.data === 'string' && next.data ? next.data : null;
  if (!runId) return { worked: false as const, runId: null, status: null };

  const status = await processResearchJob(admin, runId, workerName);
  return { worked: true as const, runId, status };
}
