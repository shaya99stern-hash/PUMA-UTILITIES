import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { ensurePumaSession, type PumaBootstrapSession } from './lib/anonymous-auth';
import { PUMA_SUPABASE_PUBLISHABLE_KEY, PUMA_SUPABASE_URL } from './lib/supabase-config';

const CANONICAL_HOST = 'puma-utilities.vercel.app';
const DEVICE_COOKIE = 'puma-device';
const DEVICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2;
const DEVICE_BOOTSTRAP_URL = `${PUMA_SUPABASE_URL}/functions/v1/puma-device-bootstrap`;

function validDeviceToken(value: string | undefined): value is string {
  return Boolean(value && /^[a-f0-9]{64}$/.test(value));
}

function createDeviceToken() {
  return `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`;
}

async function bootstrapDeviceSession(deviceToken: string): Promise<PumaBootstrapSession> {
  const result = await fetch(DEVICE_BOOTSTRAP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ deviceToken }),
    cache: 'no-store',
  });

  if (!result.ok) throw new Error(`AUTH_UNAVAILABLE: device bootstrap returned ${result.status}`);
  const body = await result.json() as Partial<PumaBootstrapSession>;
  if (!body.access_token || !body.refresh_token) throw new Error('AUTH_UNAVAILABLE: incomplete device session');
  return { access_token: body.access_token, refresh_token: body.refresh_token };
}

export async function proxy(request: NextRequest) {
  if (process.env.VERCEL_ENV === 'production') {
    const host = (request.headers.get('host') ?? request.nextUrl.hostname).split(':')[0].toLowerCase();
    if (host.endsWith('.vercel.app') && host !== CANONICAL_HOST) {
      const url = new URL(request.url);
      url.protocol = 'https:';
      url.hostname = CANONICAL_HOST;
      url.port = '';
      return NextResponse.redirect(url, 308);
    }
  }

  if (request.nextUrl.pathname === '/login') {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = '/';
    homeUrl.search = '';
    return NextResponse.redirect(homeUrl);
  }

  let deviceToken = request.cookies.get(DEVICE_COOKIE)?.value;
  if (!validDeviceToken(deviceToken)) {
    deviceToken = createDeviceToken();
    request.cookies.set(DEVICE_COOKIE, deviceToken);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(PUMA_SUPABASE_URL, PUMA_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  try {
    await ensurePumaSession(supabase, () => bootstrapDeviceSession(deviceToken));
    response.headers.set('x-puma-auth', 'ready');
  } catch {
    // Keep the local-first UI available if auth infrastructure is temporarily unreachable.
    // Server-backed routes still fail closed through requireWorkspace().
    response.headers.set('x-puma-auth', 'unavailable');
  }

  response.cookies.set(DEVICE_COOKIE, deviceToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: DEVICE_MAX_AGE_SECONDS,
  });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
