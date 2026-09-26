import { createClient } from 'npm:@supabase/supabase-js@2.109.0';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.1.0';

const TEAM_SLUG = 'shaya99stern-4910s-projects';
const TEAM_ID = 'team_jpn60UoglIwzJtcAwPyPEbmj';
const PROJECT_ID = 'prj_C4OL0KlZAcpUC5PgUsVMpUpkHj5b';
const PROJECT_NAME = 'puma-utilities';
const ISSUER = `https://oidc.vercel.com/${TEAM_SLUG}`;
const AUDIENCE = `https://vercel.com/${TEAM_SLUG}`;
const JWKS = createRemoteJWKSet(new URL('/.well-known/jwks', ISSUER));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
    },
  });
}

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64Url(bytes: ArrayBuffer) {
  const raw = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function sha256(value: string) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
}

async function verifyPumaVercelIdentity(token: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: ISSUER,
    audience: AUDIENCE,
  });

  const environment = String(payload.environment ?? '');
  const valid = payload.owner_id === TEAM_ID
    && payload.project_id === PROJECT_ID
    && payload.project === PROJECT_NAME
    && (environment === 'production' || environment === 'preview');

  if (!valid) throw new Error('invalid Puma Vercel workload identity');
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authorization = request.headers.get('authorization') ?? '';
  const oidcToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!oidcToken) return json({ error: 'unauthorized' }, 401);

  try {
    await verifyPumaVercelIdentity(oidcToken);
  } catch {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: { deviceToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const deviceToken = typeof body.deviceToken === 'string' ? body.deviceToken : '';
  if (!/^[a-f0-9]{64}$/.test(deviceToken)) return json({ error: 'invalid_device_token' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) return json({ error: 'server_misconfigured' }, 503);

  const deviceHash = bytesToHex(await sha256(deviceToken));
  const passwordDigest = await hmac(serviceRoleKey, `puma-device-password:${deviceToken}`);
  const email = `puma-device-${deviceHash.slice(0, 40)}@device.invalid`;
  const password = `${bytesToBase64Url(passwordDigest)}Aa1!`;

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let signedIn = await authClient.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) {
    const created = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { puma_device: true },
    });

    if (created.error && !/already|registered|exists/i.test(created.error.message)) {
      return json({ error: 'device_identity_unavailable' }, 503);
    }

    signedIn = await authClient.auth.signInWithPassword({ email, password });
  }

  const session = signedIn.data.session;
  if (signedIn.error || !session?.access_token || !session.refresh_token) {
    return json({ error: 'device_session_unavailable' }, 503);
  }

  return json({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at ?? null,
  });
});
