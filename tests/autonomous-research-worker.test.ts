import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('research engine has a secure autonomous worker tick driven by Supabase cron', () => {
  const route = readFileSync(new URL('../app/api/research/worker-tick/route.ts', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../lib/server/research-worker.ts', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../supabase/migrations/202609250009_autonomous_research_worker.sql', import.meta.url), 'utf8');

  assert.match(route, /Authorization/i);
  assert.match(route, /verify_research_worker_token/);
  assert.match(route, /claim_research_worker_tick/);
  assert.match(route, /release_research_worker_tick/);
  assert.match(worker, /next_research_run_for_worker/);
  assert.match(worker, /processResearchJob/);
  assert.match(migration, /create extension if not exists pg_cron/i);
  assert.match(migration, /create extension if not exists pg_net/i);
  assert.match(migration, /verify_research_worker_token/i);
  assert.match(migration, /claim_research_worker_tick/i);
  assert.match(migration, /next_research_run_for_worker/i);
  assert.match(migration, /net\.http_post/i);
  assert.match(migration, /cron\.schedule/i);
  assert.doesNotMatch(migration, /grant\s+execute[^;]*\b(?:anon|authenticated)\b/i);
});

test('expired leased or running tasks can be reclaimed without consuming another attempt', () => {
  const migration = readFileSync(new URL('../supabase/migrations/202609250009_autonomous_research_worker.sql', import.meta.url), 'utf8');
  assert.match(migration, /status\s+in\s*\(\s*'leased'\s*,\s*'running'\s*\)/i);
  assert.match(migration, /case\s+when\s+t\.status\s*=\s*'queued'[\s\S]*attempt_count\s*\+\s*1[\s\S]*else\s+t\.attempt_count/i);
});

test('browser pump shares the autonomous worker lease so two executors cannot mutate one run concurrently', () => {
  const pump = readFileSync(new URL('../app/api/research/jobs/[runId]/pump/route.ts', import.meta.url), 'utf8');
  assert.match(pump, /claim_research_worker_tick/);
  assert.match(pump, /release_research_worker_tick/);
});
