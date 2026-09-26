import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { processResearchJob } from './research-jobs';

type DbClient = SupabaseClient<any, any, any>;

export async function processNextResearchWork(client: DbClient, workerName: string) {
  const next = await client.rpc('next_research_run_for_worker');
  if (next.error) throw new Error(`Unable to inspect the research queue: ${next.error.message}`);

  const runId = typeof next.data === 'string' && next.data ? next.data : null;
  if (!runId) return { worked: false as const, busy: false as const, runId: null, status: null };

  const claimed = await client.rpc('claim_research_run_tick', {
    worker_name: workerName,
    target_run_id: runId,
    lease_seconds: 45,
  });
  if (claimed.error) throw new Error(`Unable to coordinate research run: ${claimed.error.message}`);
  if (claimed.data !== true) {
    return { worked: false as const, busy: true as const, runId, status: null };
  }

  try {
    const status = await processResearchJob(client, runId, workerName);
    return { worked: true as const, busy: false as const, runId, status };
  } finally {
    const released = await client.rpc('release_research_run_tick', {
      worker_name: workerName,
      target_run_id: runId,
    });
    if (released.error) console.error('research run lease release failed', released.error.message);
  }
}
