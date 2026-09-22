import { NextResponse, type NextRequest } from 'next/server';

const CANONICAL_HOST = 'puma-utilities.vercel.app';

export function proxy(request: NextRequest) {
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
  return NextResponse.next();
}

export const config = {
  matcher: '/:path*',
};
