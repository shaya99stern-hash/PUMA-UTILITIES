import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ensurePumaSession } from '../lib/anonymous-auth';

function fakeSupabase(options: {
  currentUser?: { id: string } | null;
  anonymousUser?: { id: string } | null;
  anonymousError?: { message: string } | null;
}) {
  let anonymousCalls = 0;
  return {
    client: {
      auth: {
        async getUser() {
          return { data: { user: options.currentUser ?? null }, error: null };
        },
        async signInAnonymously() {
          anonymousCalls += 1;
          return {
            data: { user: options.anonymousUser ?? null },
            error: options.anonymousError ?? null,
          };
        },
      },
    },
    anonymousCalls: () => anonymousCalls,
  };
}

test('existing Puma session is reused without creating an anonymous identity', async () => {
  const fake = fakeSupabase({ currentUser: { id: 'existing-user' } });
  const user = await ensurePumaSession(fake.client);
  assert.equal(user.id, 'existing-user');
  assert.equal(fake.anonymousCalls(), 0);
});

test('missing Puma session is replaced by a silent anonymous session', async () => {
  const fake = fakeSupabase({ currentUser: null, anonymousUser: { id: 'anonymous-user' } });
  const user = await ensurePumaSession(fake.client);
  assert.equal(user.id, 'anonymous-user');
  assert.equal(fake.anonymousCalls(), 1);
});

test('anonymous session bootstrap fails closed when Supabase rejects it', async () => {
  const fake = fakeSupabase({ currentUser: null, anonymousError: { message: 'anonymous disabled' } });
  await assert.rejects(() => ensurePumaSession(fake.client), /AUTH_UNAVAILABLE/);
  assert.equal(fake.anonymousCalls(), 1);
});

test('Puma proxy silently bootstraps auth and never redirects operational routes to login', () => {
  const proxy = readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8');
  assert.match(proxy, /ensurePumaSession/);
  assert.match(proxy, /signInAnonymously|anonymous/i);
  assert.doesNotMatch(proxy, /PROTECTED_PREFIXES/);
  assert.doesNotMatch(proxy, /loginUrl/);
  assert.doesNotMatch(proxy, /pathname\s*=\s*['"]\/login['"]/);
});

test('legacy Puma login route is retired to the app home screen', () => {
  const login = readFileSync(new URL('../app/login/page.tsx', import.meta.url), 'utf8');
  assert.match(login, /redirect\(['"]\/['"]\)/);
  assert.doesNotMatch(login, /signInWithOtp|verifyOtp|Check your email|Sign in/);
});

test('server-backed Puma routes use the same silent session bootstrap', () => {
  const workspace = readFileSync(new URL('../lib/server/current-workspace.ts', import.meta.url), 'utf8');
  assert.match(workspace, /ensurePumaSession/);
  assert.doesNotMatch(workspace, /AUTH_REQUIRED/);
});
