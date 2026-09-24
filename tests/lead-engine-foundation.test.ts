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
