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
  withEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: undefined }, () => assert.throws(() => serverEnv(), /SUPABASE_SERVICE_ROLE_KEY/));
});

test('public env returns only publishable settings', () => {
  withEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: 'server-secret' }, () => assert.deepEqual(publicSupabaseEnv(), { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' }));
});

test('.env.example contains names but no JWT-like secret', () => {
  const source = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY=/);
  assert.doesNotMatch(source, /eyJ[A-Za-z0-9_-]{20,}/);
});

test('foundation migration defines canonical tables, RLS and atomic leasing', () => {
  const sql = readFileSync(new URL('../supabase/migrations/202609240001_lead_engine_foundation.sql', import.meta.url), 'utf8');
  for (const table of ['workspaces','companies','people','company_people','properties','company_properties','utilities','property_utilities','tariffs','activity_notes','follow_ups','pipeline_events','research_runs','research_tasks','research_sources','research_evidence','research_claims','research_entities','entity_aliases','entity_links','source_health_events','provider_accounts','provider_quota_snapshots','provider_usage_events','provider_backoff_state']) assert.match(sql, new RegExp(`create table(?: if not exists)? public\\.${table}\\b`, 'i'));
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /create or replace function public\.lease_research_tasks/i);
  assert.match(sql, /for update skip locked/i);
});

test('effective workspace ownership helper is not a SECURITY DEFINER RPC and advisor indexes are migration-pinned', () => {
  const hardening = readFileSync(new URL('../supabase/migrations/202609240002_foundation_hardening.sql', import.meta.url), 'utf8');
  const ownershipFunction = hardening.match(/create or replace function public\.owns_workspace[\s\S]*?\$\$;/i)?.[0] ?? '';
  assert.match(ownershipFunction, /security invoker/i);
  assert.doesNotMatch(ownershipFunction, /security definer/i);
  assert.match(hardening, /revoke all on function public\.owns_workspace\(uuid\) from anon/i);
  assert.match(hardening, /owner_user_id = \(select auth\.uid\(\)\)/i);
  assert.match(hardening, /create index if not exists research_tasks_workspace_id_idx/i);
  assert.match(hardening, /create index if not exists tariffs_utility_id_idx/i);
});

test('canonical workspace extension persists parcels, meters, readings, monitor settings and accounts payable', () => {
  const sql = readFileSync(new URL('../supabase/migrations/202609240003_complete_workspace_storage.sql', import.meta.url), 'utf8');
  for (const table of ['parcels','meters','usage_readings','monitor_settings','accounts_payable']) assert.match(sql, new RegExp(`create table(?: if not exists)? public\\.${table}\\b`, 'i'));
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /public\.owns_workspace\(workspace_id\)/i);
});

test('Puma login uses remembered six-digit email OTP rather than magic-link navigation', () => {
  const login = readFileSync(new URL('../app/login/page.tsx', import.meta.url), 'utf8');
  assert.match(login, /signInWithOtp/); assert.match(login, /verifyOtp/); assert.match(login, /type:\s*['"]email['"]/); assert.match(login, /maxLength=\{6\}/); assert.match(login, /inputMode=['"]numeric['"]/); assert.match(login, /puma-login-email/); assert.doesNotMatch(login, /magic link/i); assert.doesNotMatch(login, /emailRedirectTo/);
});

test('authenticated boundary protects operational routes and preserves canonical redirect', () => {
  const proxy = readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8');
  const workspace = readFileSync(new URL('../lib/server/current-workspace.ts', import.meta.url), 'utf8');
  assert.match(proxy, /CANONICAL_HOST/); for (const route of ['/clients','/engine','/monitor','/settings']) assert.match(proxy, new RegExp(route.replace('/', '\\/'))); assert.match(proxy, /\/login/); assert.match(workspace, /requireUser/); assert.match(workspace, /requireWorkspace/);
});

test('Settings exposes Supabase health testing and safe reconnection controls', () => {
  const hub = readFileSync(new URL('../app/components/puma-settings-hub.tsx', import.meta.url), 'utf8');
  const health = readFileSync(new URL('../app/components/puma-supabase-health.tsx', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../app/settings/supabase/page.tsx', import.meta.url), 'utf8');
  const healthRoute = readFileSync(new URL('../app/api/system/supabase-health/route.ts', import.meta.url), 'utf8');
  assert.match(hub, /\/settings\/supabase/); assert.match(page, /PumaSupabaseHealth/); assert.match(health, /Test connection/i); assert.match(health, /Reconnect Supabase/i); assert.match(health, /\/api\/system\/supabase-health/); assert.match(health, /refreshSession/); assert.match(healthRoute, /latencyMs/); assert.match(healthRoute, /database/);
});