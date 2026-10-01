/** CAN-SPAM footer, unsubscribe links and List-Unsubscribe headers. Pure. */
import { escapeHtml } from './merge';

export class ComplianceError extends Error {}

export function baseUrlFrom(origin?: string | null): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const base = (env || origin || 'http://localhost:3000').replace(/\/+$/, '');
  return base;
}

export function unsubscribeUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/u/${token}`;
}

/** The workspace mailing address, or null when not set yet (sending still works; the UI warns). */
export function normalizeCompanyAddress(address: string | null | undefined): string | null {
  const value = address?.replace(/\s+/g, ' ').trim();
  return value && value.length >= 8 ? value : null;
}

export const MISSING_ADDRESS_WARNING =
  'No mailing address yet: emails will go out without one. US CAN-SPAM rules require a physical postal address in marketing email (a P.O. box or virtual mailbox works), so add one in Settings > Email before real outreach.';

export function requireCompanyAddress(address: string | null | undefined): string {
  const value = address?.replace(/\s+/g, ' ').trim();
  if (!value || value.length < 8) {
    throw new ComplianceError(
      'Add your company mailing address in Settings > Email before sending. Federal CAN-SPAM rules require a physical address in every marketing email.',
    );
  }
  return value;
}

export type FooterInput = {
  address: string;
  unsubscribeUrl: string;
  senderName?: string | null;
  companyName?: string | null;
};

export function footerHtml(f: FooterInput): string {
  const who = [f.senderName, f.companyName].filter(Boolean).join(', ');
  return (
    `<div style="margin-top:28px;padding-top:12px;border-top:1px solid #e3e3e3;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#7a7a7a">` +
    (who ? `${escapeHtml(who)}<br>` : '') +
    (f.address.trim() ? `${escapeHtml(f.address)}<br>` : '') +
    `You are receiving this because we think our water-savings program may be relevant to your properties. ` +
    `<a href="${escapeHtml(f.unsubscribeUrl)}" style="color:#7a7a7a;text-decoration:underline">Unsubscribe</a>` +
    `</div>`
  );
}

export function footerText(f: FooterInput): string {
  const who = [f.senderName, f.companyName].filter(Boolean).join(', ');
  return ['', '--', who, f.address, `Unsubscribe: ${f.unsubscribeUrl}`].filter((l, i) => i < 2 || l).join('\n');
}

/** RFC 2369 + RFC 8058 headers. Gmail and Yahoo require the one-click POST header for bulk senders. */
export function listUnsubscribeHeaders(opts: { url: string; mailto?: string | null }): Record<string, string> {
  const parts = [`<${opts.url}>`];
  if (opts.mailto) parts.push(`<mailto:${opts.mailto}?subject=unsubscribe>`);
  return { 'List-Unsubscribe': parts.join(', '), 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}

export function wrapEmailHtml(inner: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f1f1f">${inner}</div>`;
}
