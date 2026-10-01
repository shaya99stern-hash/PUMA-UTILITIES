import 'server-only';
import { pumpJob, runnableJobs } from './jobs';

/**
 * Background research step called by /api/cron/tick every minute: advances queued/running
 * research jobs within the time budget so research continues when nobody has the page open.
 */
export async function runResearchTick({ budgetMs }: { budgetMs: number }) {
  const started = Date.now();
  const jobs = await runnableJobs(3);
  const results: { id: string; status: string; progress: number }[] = [];
  for (const job of jobs) {
    const remaining = budgetMs - (Date.now() - started);
    if (remaining < 8000) break;
    const r = await pumpJob(job.id, Math.min(remaining, budgetMs));
    if (r) results.push({ id: job.id, ...r });
  }
  return { jobs: results.length, results };
}
