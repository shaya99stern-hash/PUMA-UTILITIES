import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ensurePumaSession } from '../lib/anonymous-auth';

function fakeSupabase(options: {
  currentUser?: { id: string } | null;
  sessionUser?: { id: string } | null;
}) {
  let setSessionCalls = 0;
  return {
    client: {
      auth: {
        async getUser() {
          return { data: { user: options.currentUser ?? null }, error: null };
        },
        async setSession(session: { access_token: string; refresh_token: string }) {
          setSessionCalls += 1;
          assert.equal(session.access_token, 'access');
          assert.equal(session.refresh_token, 'refresh');
          return { data: { user: options.sessionUser ?? null }, error: null };
        },
      },
    },
    setSessionCalls: () => setSessionCalls,
  };
}

test('existing Puma session is reused without device bootstrap', async () => {
  const fake = fakeSupabase({ currentUser: { id: 'existing-user' } });
  let bootstraps = 0;
  const user = await ensurePumaSession(fake.client, async () => {
    bootstraps += 1;
    return { access_token: 'access', refresh_token: 'refresh' };
  });
  assert.equal(user.id, 'existing-user');
  assert.equal(bootstraps, 0);
  assert.equal(fake.setSessionCalls(), 0);
});

test('missing Puma session is replaced by a silent device bootstrap session', async () => {
  const fake = fakeSupabase({ currentUser: null, sessionUser: { id: 'device-user' } });
  const user = await ensurePumaSession(fake.client, async () => ({ access_token: 'access', refresh_token: 'refresh' }));
  assert.equal(user.id, 'device-user');
  assert.equal(fake.setSessionCalls(), 1);
});

test('missing Puma session fails closed when no trusted bootstrap is available', async () => {
  const fake = fakeSupabase({ currentUser: null });
  await assert.rejects(() => ensurePumaSession(fake.client), /AUTH_UNAVAILABLE/);
});

test('Puma proxy silently bootstraps with a secure device cookie without requiring Vercel OIDC', () => {
  const proxy = readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8');
  assert.match(proxy, /puma-device/);
  assert.match(proxy, /puma-device-bootstrap/);
  assert.match(proxy, /httpOnly:\s*true/);
  assert.match(proxy, /secure:\s*true/);
  assert.match(proxy, /ensurePumaSession/);
  assert.doesNotMatch(proxy, /VERCEL_OIDC_TOKEN/);
  assert.doesNotMatch(proxy, /signInAnonymously/);
  assert.doesNotMatch(proxy, /PROTECTED_PREFIXES/);
  assert.doesNotMatch(proxy, /loginUrl/);
});

test('machine worker route bypasses user-session bootstrap before a device identity can be created', () => {
  const proxy = readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8');
  const machineGuard = proxy.indexOf("'/api/research/worker-tick'");
  const createDevice = proxy.indexOf('createDeviceToken()');
  assert.ok(machineGuard >= 0, 'expected an explicit worker-tick machine bypass');
  assert.ok(createDevice >= 0, 'expected device bootstrap code');
  assert.ok(machineGuard < createDevice, 'machine bypass must run before device identity creation');
  assert.match(proxy, /isMachineRequest/);
});

test('first browser request only establishes the device cookie, then redirects once before Supabase bootstrap', () => {
  const proxy = readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8');
  assert.match(proxy, /bootstrapDeviceCookie/);
  assert.match(proxy, /NextResponse\.redirect\([^\n]+307\)/);
  assert.match(proxy, /request\.method === 'GET'/);
  assert.match(proxy, /!validDeviceToken\(deviceToken\)/);
});

test('server-backed routes can recover a missing Supabase auth cookie from the stable device cookie', () => {
  const workspace = readFileSync(new URL('../lib/server/current-workspace.ts', import.meta.url), 'utf8');
  const bootstrap = readFileSync(new URL('../lib/server/device-session.ts', import.meta.url), 'utf8');
  assert.match(workspace, /getDeviceBootstrapSession/);
  assert.match(workspace, /ensurePumaSession\(supabase, getDeviceBootstrapSession\)/);
  assert.match(bootstrap, /puma-device/);
  assert.match(bootstrap, /puma-device-bootstrap/);
  assert.match(bootstrap, /access_token/);
  assert.match(bootstrap, /refresh_token/);
});

test('Supabase device bootstrap is rate limited before it creates a device identity', () => {
  const edge = readFileSync(new URL('../supabase/functions/puma-device-bootstrap/index.ts', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../supabase/migrations/202609260001_device_bootstrap_registry.sql', import.meta.url), 'utf8');
  assert.match(edge, /reserve_puma_device_bootstrap/);
  assert.match(edge, /cf-connecting-ip/i);
  assert.match(edge, /createUser/);
  assert.match(edge, /signInWithPassword/);
  assert.doesNotMatch(edge, /oidc\.vercel\.com|VERCEL_OIDC_TOKEN|jwtVerify/);
  assert.doesNotMatch(edge, /Access-Control-Allow-Origin:\s*['"]\*['"]/);
  assert.match(migration, /create table public\.puma_device_bootstrap_registry/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /create or replace function public\.reserve_puma_device_bootstrap/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /interval '24 hours'/i);
  assert.match(migration, />= 5/);
  assert.match(migration, />= 25/);
  assert.match(migration, /revoke all/i);
  assert.match(migration, /grant execute on function public\.reserve_puma_device_bootstrap.*service_role/i);
});

test('legacy Puma login route is retired to the app home screen', () => {
  const login = readFileSync(new URL('../app/login/page.tsx', import.meta.url), 'utf8');
  assert.match(login, /redirect\(['"]\/['"]\)/);
  assert.doesNotMatch(login, /signInWithOtp|verifyOtp|Check your email|Sign in/);
});

test('server-backed Puma routes require a Puma session rather than a login page', () => {
  const workspace = readFileSync(new URL('../lib/server/current-workspace.ts', import.meta.url), 'utf8');
  assert.match(workspace, /ensurePumaSession/);
  assert.doesNotMatch(workspace, /AUTH_REQUIRED|signInWithOtp|signInAnonymously/);
});
