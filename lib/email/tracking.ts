/** Open pixel and click tracking link rewriting. Pure. */
import { escapeHtml } from './merge';
import { hmacHex, verifyHmac } from './sign';

export const MAX_REDIRECT_LENGTH = 2048;

/** Only absolute http(s) URLs without credentials may be redirected to. */
export function safeRedirectUrl(raw: string | null | undefined): string | null {
  if (!raw || raw.length > MAX_REDIRECT_LENGTH) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Signature that ties a tracked URL to its recipient token so links cannot be forged into an open redirect. */
export function clickSignature(token: string, url: string): string | null {
  return hmacHex('click', `${token}\n${url}`, 20);
}

export function verifyClickSignature(token: string, url: string, sig: string | null | undefined): boolean {
  // Without an encryption key signatures are unavailable (local dev); the token lookup still gates the redirect.
  if (!process.env.PUMA_ENCRYPTION_KEY?.trim()) return true;
  return verifyHmac('click', `${token}\n${url}`, sig, 20);
}

export function trackedLink(baseUrl: string, token: string, url: string, step?: number): string {
  const base = baseUrl.replace(/\/+$/, '');
  const sig = clickSignature(token, url);
  const qs = new URLSearchParams({ u: url });
  if (step !== undefined) qs.set('s', String(step));
  if (sig) qs.set('k', sig);
  return `${base}/t/c/${token}?${qs.toString()}`;
}

/**
 * Rewrites http(s) hrefs so clicks pass through /t/c/<token>. Skips mailto/tel/anchors,
 * the unsubscribe link and anything that is already tracked.
 */
export function rewriteLinks(html: string, opts: { baseUrl: string; token: string; step?: number; skip?: (url: string) => boolean }): string {
  const base = opts.baseUrl.replace(/\/+$/, '');
  return html.replace(/(<a\b[^>]*?\bhref\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, (match, prefix: string, dq?: string, sq?: string) => {
    const raw = (dq ?? sq ?? '').replace(/&amp;/g, '&').trim();
    const safe = safeRedirectUrl(raw);
    if (!safe) return match;
    if (safe.startsWith(`${base}/t/`) || safe.startsWith(`${base}/u/`)) return match;
    if (opts.skip?.(safe)) return match;
    return `${prefix}"${escapeHtml(trackedLink(opts.baseUrl, opts.token, safe, opts.step))}"`;
  });
}

export function pixelUrl(baseUrl: string, token: string, step?: number): string {
  return `${baseUrl.replace(/\/+$/, '')}/t/o/${token}${step !== undefined ? `?s=${step}` : ''}`;
}

export function trackingPixel(baseUrl: string, token: string, step?: number): string {
  return `<img src="${escapeHtml(pixelUrl(baseUrl, token, step))}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0">`;
}

/** 1x1 transparent GIF. */
export const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
