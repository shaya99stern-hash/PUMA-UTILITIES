import { NextResponse } from 'next/server';
import { isToken, recordClick } from '@/lib/email/public';
import { safeRedirectUrl, verifyClickSignature } from '@/lib/email/tracking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Click tracking: records the click, then 302s to the destination (http/https only, signed by the sender). */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = new URL(request.url);
  const target = safeRedirectUrl(url.searchParams.get('u'));
  if (!target || !isToken(token) || !verifyClickSignature(token, target, url.searchParams.get('k'))) {
    return new NextResponse('This link is not valid.', { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const step = Number.parseInt(url.searchParams.get('s') ?? '', 10);
  await recordClick(token, target, Number.isFinite(step) ? step : null).catch(() => undefined);
  return NextResponse.redirect(target, { status: 302, headers: { 'Cache-Control': 'no-store' } });
}
