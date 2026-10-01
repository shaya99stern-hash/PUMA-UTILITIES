import 'server-only';

/**
 * Background research step called by /api/cron/tick.
 * Placeholder until the job runner lands: reports that no research jobs ran.
 */
export async function runResearchTick({ budgetMs }: { budgetMs: number }) {
  return { skipped: true, reason: 'research job runner not deployed yet', budgetMs };
}
