import { isToken, recordOpen } from '@/lib/email/public';
import { TRANSPARENT_GIF } from '@/lib/email/tracking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Open-tracking pixel. Always answers with the 1x1 GIF, even for unknown tokens. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const step = Number.parseInt(new URL(request.url).searchParams.get('s') ?? '', 10);
  if (isToken(token)) await recordOpen(token, Number.isFinite(step) ? step : null).catch(() => undefined);
  return new Response(new Uint8Array(TRANSPARENT_GIF), {
    headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', 'Content-Length': String(TRANSPARENT_GIF.length) },
  });
}
