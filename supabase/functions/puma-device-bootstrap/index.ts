import { createClient } from 'npm:@supabase/supabase-js@2.109.0';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.1.0';

const TEAM_SLUG = 'shaya99stern-4910s-projects';
const TEAM_ID = 'team_jpn60UoglIwzJtcAwPyPEbmj';
const PROJECT_ID = 'prj_C4OL0KlZAcpUC5PgUsVMpUpkHj5b';
const PROJECT_NAME = 'puma-utilities';
const OIDC_ISSUER = `https://oidc.vercel.com/${TEAM_SLUG}`;
const OIDC_AUDIENCE = `https://vercel.com/${TEAM_SLUG}`;
const OIDC_JWKS = createRemoteJWKSet(new URL(`${OIDC_ISSUER}/.well-known/jwks`));

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

function clientIp(request: Request) {
  return request.headers.get('cf-connecting-ip')?.trim()
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || 'unknown';
}

async function isTrustedPumaVercel(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) return false;

  try {
    const { payload } = await jwtVerify(token, OIDC_JWKS, {
      issuer: OIDC_ISSUER,
      audience: OIDC_AUDIENCE,
    });
    const environment = String(payload.environment ?? '');
    const subject = String(payload.sub ?? '');
    const expectedSubjectPrefix = `owner:${TEAM_SLUG}:project:${PROJECT_NAME}:environment:`;

    return payload.owner_id === TEAM_ID
      && payload.project_id === PROJECT_ID
      && payload.project === PROJECT_NAME
      && subject === `${expectedSubjectPrefix}${environment}`
      && (environment === 'production' || environment === 'preview');
  } catch {
    return false;
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

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

  const trustedVercel = await isTrustedPumaVercel(request);
  const deviceHash = bytesToHex(await sha256(deviceToken));
  const ipHash = bytesToHex(await hmac(serviceRoleKey, `puma-bootstrap-ip:${clientIp(request)}`));
  const passwordDigest = await sha256(`puma-device-password:${deviceToken}`);
  const email = `puma-device-${deviceHash.slice(0, 40)}@device.invalid`;
  const password = `${bytesToBase64Url(passwordDigest)}Aa1!`;

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const reserved = await adminClient.rpc('reserve_puma_device_bootstrap', {
    p_device_hash: deviceHash,
    p_ip_hash: ipHash,
    p_trusted: trustedVercel,
  });
  if (reserved.error) return json({ error: 'bootstrap_registry_unavailable' }, 503);

  const disposition = String(reserved.data ?? '');
  if (disposition === 'ip_limit' || disposition === 'global_limit') {
    return json({ error: 'bootstrap_rate_limited' }, 429);
  }
  if (disposition !== 'new' && disposition !== 'existing') {
    return json({ error: 'bootstrap_registry_unavailable' }, 503);
  }

  let signedIn = await authClient.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) {
    const created = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { puma_device: true },
    });

    if (created.error && !/already|registered|exists/i.test(created.error.message)) {
      if (disposition === 'new') {
        await adminClient.from('puma_device_bootstrap_registry').delete().eq('device_hash', deviceHash);
      }
      return json({ error: 'device_identity_unavailable' }, 503);
    }

    signedIn = await authClient.auth.signInWithPassword({ email, password });
  }

  const session = signedIn.data.session;
  if (signedIn.error || !session?.access_token || !session.refresh_token || !session.user?.id) {
    return json({ error: 'device_session_unavailable' }, 503);
  }

  const registryUpdate = await adminClient
    .from('puma_device_bootstrap_registry')
    .update({ user_id: session.user.id, last_seen_at: new Date().toISOString() })
    .eq('device_hash', deviceHash);
  if (registryUpdate.error) return json({ error: 'bootstrap_registry_unavailable' }, 503);

  return json({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at ?? null,
  });
});
