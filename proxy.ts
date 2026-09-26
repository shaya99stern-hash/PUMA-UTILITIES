import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { PUMA_SUPABASE_PUBLISHABLE_KEY, PUMA_SUPABASE_URL } from './lib/supabase-config';

const CANONICAL_HOST = 'puma-utilities.vercel.app';
const PROTECTED_PREFIXES = ['/clients', '/engine', '/monitor', '/settings'];

function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
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

  let response = NextResponse.next({ request });
  const supabase = createServerClient(PUMA_SUPABASE_URL, PUMA_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  if (!user && isProtectedPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname === '/login') {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = '/';
    homeUrl.search = '';
    return NextResponse.redirect(homeUrl);
  }

  return response;
}

export const config = {
  matcher: '/:path*',
};