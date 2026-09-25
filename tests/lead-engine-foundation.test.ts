import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { publicSupabaseEnv, serverEnv } from '../lib/server/env';

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const before = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { run(); } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('server env rejects a missing service role secret', () => {
  withEnv({
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_SERVICE_ROLE_KEY: undefined,
  }, () => assert.throws(() => serverEnv(), /SUPABASE_SERVICE_ROLE_KEY/));
});

test('public env returns only publishable settings', () => {
  withEnv({
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_SERVICE_ROLE_KEY: 'server-secret',
  }, () => assert.deepEqual(publicSupabaseEnv(), {
    url: 'https://example.supabase.co',
    publishableKey: 'sb_publishable_test',
  }));
});

test('.env.example contains names but no JWT-like secret', () => {
  const source = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY=/);
  assert.doesNotMatch(source, /eyJ[A-Za-z0-9_-]{20,}/);
});

test('foundation migration defines canonical tables, RLS and atomic leasing', () => {
  const sql = readFileSync(new URL('../supabase/migrations/202609240001_lead_engine_foundation.sql', import.meta.url), 'utf8');
  for (const table of [
    'workspaces','companies','people','company_people','properties','company_properties',
    'utilities','property_utilities','tariffs','activity_notes','follow_ups','pipeline_events',
    'research_runs','research_tasks','research_sources','research_evidence','research_claims',
    'research_entities','entity_aliases','entity_links','source_health_events',
    'provider_accounts','provider_quota_snapshots','provider_usage_events','provider_backoff_state',
  ]) assert.match(sql, new RegExp(`create table(?: if not exists)? public\\.${table}\\b`, 'i'));
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /create or replace function public\.lease_research_tasks/i);
  assert.match(sql, /for update skip locked/i);
});

test('workspace ownership helper is not a SECURITY DEFINER RPC and advisor indexes are migration-pinned', () => {
  const foundation = readFileSync(new URL('../supabase/migrations/202609240001_lead_engine_foundation.sql', import.meta.url), 'utf8');
  const hardening = readFileSync(new URL('../supabase/migrations/202609240002_foundation_hardening.sql', import.meta.url), 'utf8');
  const ownershipFunction = foundation.match(/create or replace function public\.owns_workspace[\s\S]*?\$\$;/i)?.[0] ?? '';
  assert.match(ownershipFunction, /security invoker/i);
  assert.doesNotMatch(ownershipFunction, /security definer/i);
  assert.match(hardening, /owner_user_id = \(select auth\.uid\(\)\)/i);
  assert.match(hardening, /create index if not exists research_tasks_workspace_id_idx/i);
  assert.match(hardening, /create index if not exists tariffs_utility_id_idx/i);
});