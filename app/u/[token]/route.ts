import { escapeHtml } from '@/lib/email/merge';
import { findRecipient, isToken, maskEmail, publicPage, unsubscribe } from '@/lib/email/public';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ token: string }> };

/**
 * Public unsubscribe page. GET only shows a confirmation button (mail scanners and link previews follow links,
 * so a GET must never unsubscribe anyone). POST unsubscribes: the button posts here, and mail clients use the same
 * endpoint for RFC 8058 one-click (`List-Unsubscribe=One-Click`).
 */
export async function GET(_request: Request, { params }: Ctx) {
  const { token } = await params;
  if (token === 'preview') return publicPage('Unsubscribe', '<h1>This is a preview</h1><p>Real emails contain a personal unsubscribe link here.</p>');
  const r = await findRecipient(token);
  if (!r) return publicPage('Link not valid', '<h1>This link is no longer valid</h1><p>If you keep getting our emails, reply to one and ask us to remove you.</p>', 404);
  if (r.unsubscribed_at || r.status === 'unsubscribed') {
    return publicPage('Unsubscribed', `<h1>You are unsubscribed</h1><p><strong>${escapeHtml(maskEmail(r.email))}</strong> will not receive any more emails from us.</p>`);
  }
  return publicPage(
    'Unsubscribe',
    `<h1>Unsubscribe from our emails?</h1><p>Confirm to stop all emails to <strong>${escapeHtml(maskEmail(r.email))}</strong>.</p>
<form method="post" action="/u/${escapeHtml(token)}"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">Yes, unsubscribe me</button></form>
<small>You can ignore this page to keep receiving emails.</small>`,
  );
}

export async function POST(request: Request, { params }: Ctx) {
  const { token } = await params;
  if (!isToken(token)) return new Response('Invalid link', { status: 404 });
  const raw = await request.text().catch(() => '');
  const oneClick = /List-Unsubscribe=One-Click/i.test(raw) && !/text\/html/i.test(request.headers.get('accept') ?? '');
  const r = await unsubscribe(token, oneClick ? 'one-click' : 'page');
  if (!r) return new Response('Invalid link', { status: 404 });
  if (oneClick) return new Response('Unsubscribed', { status: 200, headers: { 'Cache-Control': 'no-store' } });
  return publicPage('Unsubscribed', `<h1>You are unsubscribed</h1><p><strong>${escapeHtml(maskEmail(r.email))}</strong> will not receive any more emails from us. Sorry to see you go.</p>`);
}
