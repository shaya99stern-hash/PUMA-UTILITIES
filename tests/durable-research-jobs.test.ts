import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('durable research seed creates a resumable company graph and bounded source tasks', async () => {
  const { createDurableResearchSeed } = await import('../lib/research/durable-job');
  const seed = createDurableResearchSeed({
    label: 'Example Management',
    geography: 'NJ',
    website: 'https://example.com',
    maxTasks: 60,
    maxDepth: 4,
    perNeed: 6,
    maxBudgetUnits: 82,
  });

  assert.equal(seed.graph.entities[0]?.label, 'Example Management');
  assert.equal(seed.rootEntityId, 'seed:company:example-management');
  assert.ok(seed.tasks.length > 0);
  assert.ok(seed.tasks.length <= 40);
  assert.ok(seed.tasks.every((task: { subjectId: string; status: string }) => task.subjectId === seed.rootEntityId && task.status === 'queued'));
  assert.ok(seed.graph.claims.some((claim: { fact: string; value?: unknown }) => claim.fact === 'company.website' && claim.value === 'https://example.com'));
});

test('durable task disposition retries retryable failures with bounded backoff and terminates exhausted work', async () => {
  const { decideDurableTaskDisposition } = await import('../lib/research/durable-job');
  assert.deepEqual(
    decideDurableTaskDisposition({ status: 'blocked', retryable: true }, 1, 3),
    { status: 'queued', retry: true, backoffSeconds: 10 },
  );
  assert.deepEqual(
    decideDurableTaskDisposition({ status: 'failed', retryable: true }, 2, 3),
    { status: 'queued', retry: true, backoffSeconds: 20 },
  );
  assert.deepEqual(
    decideDurableTaskDisposition({ status: 'failed', retryable: true }, 3, 3),
    { status: 'failed', retry: false, backoffSeconds: 0 },
  );
  assert.deepEqual(
    decideDurableTaskDisposition({ status: 'complete', retryable: false }, 1, 3),
    { status: 'complete', retry: false, backoffSeconds: 0 },
  );
});

test('Supabase migration and API expose run-scoped leasing without exposing the service role to the client', () => {
  const migration = readFileSync(new URL('../supabase/migrations/202609240004_durable_research_worker.sql', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('../lib/server/supabase-admin.ts', import.meta.url), 'utf8');
  const jobs = readFileSync(new URL('../lib/server/research-jobs.ts', import.meta.url), 'utf8');
  const createRoute = readFileSync(new URL('../app/api/research/jobs/route.ts', import.meta.url), 'utf8');
  const pumpRoute = readFileSync(new URL('../app/api/research/jobs/[runId]/pump/route.ts', import.meta.url), 'utf8');
  const statusRoute = readFileSync(new URL('../app/api/research/jobs/[runId]/route.ts', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../app/components/puma-research-panel.tsx', import.meta.url), 'utf8');

  assert.match(migration, /lease_research_tasks_for_run/i);
  assert.match(migration, /target_run_id/i);
  assert.match(migration, /unique index[\s\S]*research_tasks[\s\S]*run_id[\s\S]*subject_key[\s\S]*source_id[\s\S]*capability/i);
  assert.match(admin, /SUPABASE_SERVICE_ROLE_KEY|serviceRoleKey/);
  assert.match(jobs, /lease_research_tasks_for_run/);
  assert.match(jobs, /executeResearchTask/);
  assert.match(jobs, /provider_backoff_state/);
  assert.match(createRoute, /requireWorkspace/);
  assert.match(pumpRoute, /createAdminSupabase/);
  assert.match(statusRoute, /Cache-Control[\s\S]*no-store/);
  assert.match(ui, /\/api\/research\/jobs/);
  assert.match(ui, /puma-active-research-run/);
  assert.doesNotMatch(ui, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('Engine starts durable research at the strongest supported depth and budget', () => {
  const ui = readFileSync(new URL('../app/components/puma-research-panel.tsx', import.meta.url), 'utf8');
  assert.match(ui, /maxTasks:\s*80/);
  assert.match(ui, /maxBudgetUnits:\s*120/);
  assert.match(ui, /maxDepth:\s*5/);
  assert.match(ui, /targetCompleteness:\s*0\.9/);
  assert.match(ui, /perNeed:\s*6/);
});
