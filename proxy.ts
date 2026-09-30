import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { devAuthUserId, loginRequired, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './lib/supabase/config';

const CANONICAL_HOST = 'puma-utilities.vercel.app';

/** Paths reachable without a session. API routes enforce auth themselves. */
const PUBLIC_PREFIXES = ['/login', '/auth', '/api/', '/u/', '/t/', '/manifest.webmanifest', '/sw.js', '/offline'];

function isPublic(pathname: string) {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix.replace(/\/$/, '') || pathname.startsWith(prefix));
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

  // Open mode (default): no sign-in wall. Session cookies are only refreshed
  // when someone has chosen to sign in.
  if (devAuthUserId()) return NextResponse.next({ request });
  if (!loginRequired() && !request.cookies.getAll().some((cookie) => cookie.name.startsWith('sb-'))) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Refreshes the session cookie when needed.
  const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
  const pathname = request.nextUrl.pathname;

  if (loginRequired() && !data.user && !isPublic(pathname)) {
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(login);
  }
  if (data.user && pathname === '/login') {
    const home = request.nextUrl.clone();
    home.pathname = '/';
    home.search = '';
    return NextResponse.redirect(home);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|css|js)$).*)'],
};
