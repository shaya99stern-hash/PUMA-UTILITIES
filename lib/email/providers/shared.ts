import { randomUUID } from 'node:crypto';
import type Mail from 'nodemailer/lib/mailer';
import { htmlToText } from '../merge';
import type { OutgoingMessage } from '../types';

export function domainOf(email: string): string {
  return email.split('@')[1]?.toLowerCase() || 'localhost';
}

export function generateMessageId(fromEmail: string): string {
  return `<${randomUUID()}@${domainOf(fromEmail)}>`;
}

/** Nodemailer options for a message (used by SMTP send and to build raw MIME for the API providers). */
export function toMailOptions(msg: OutgoingMessage): Mail.Options & { messageId: string } {
  const messageId = msg.messageId ?? generateMessageId(msg.from.email);
  const refs = (msg.references ?? []).filter(Boolean);
  return {
    from: msg.from.name ? { name: msg.from.name, address: msg.from.email } : msg.from.email,
    to: msg.to,
    cc: msg.cc?.length ? msg.cc : undefined,
    bcc: msg.bcc?.length ? msg.bcc : undefined,
    subject: msg.subject,
    html: msg.html,
    text: msg.text ?? htmlToText(msg.html),
    messageId,
    inReplyTo: msg.inReplyTo || undefined,
    references: refs.length ? refs : undefined,
    headers: msg.headers,
  };
}

type ErrLike = { code?: string; responseCode?: number; response?: string; message?: string; command?: string; authenticationFailed?: boolean; responseText?: string; responseStatus?: string; serverResponseCode?: string };

/** Turns low-level socket/SMTP/IMAP failures into something a non-technical person can act on. */
export function explainMailError(error: unknown, where: 'smtp' | 'imap' | 'send' | 'sync', ctx: { host?: string; appPassword?: boolean; provider?: string } = {}): string {
  const e = (error ?? {}) as ErrLike;
  const raw = [e.responseText, e.response, e.message].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const code = e.code ?? '';
  const label = where === 'smtp' || where === 'send' ? 'sending (SMTP)' : 'reading (IMAP)';
  const host = ctx.host ? ` (${ctx.host})` : '';
  if (code === 'EAUTH' || e.authenticationFailed || e.responseCode === 535 || /auth(entication)? (failed|error)|invalid credentials|login failed|AUTHENTICATIONFAILED|username and password not accepted|application-specific password|app password/i.test(raw)) {
    return ctx.appPassword
      ? `The mail server${host} rejected the login for ${label}. This provider needs an app password, not your normal password. Create one, paste it here, and try again.`
      : `The mail server${host} rejected the username or password for ${label}. Check both and try again.`;
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `Could not find the mail server${host}. Check the host name for ${label}.`;
  if (code === 'ECONNREFUSED') return `The mail server${host} refused the connection for ${label}. Check the port and the SSL/STARTTLS setting.`;
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' && /timed? ?out/i.test(raw) || code === 'ECONNECTION' && /timed? ?out/i.test(raw) || /timed out|timeout/i.test(raw)) {
    return `Timed out connecting to the mail server${host} for ${label}. Check the host and port, and that your network allows the connection.`;
  }
  if (/certificate|self[- ]signed|CERT_|ssl|tls|wrong version number|handshake/i.test(raw) || code === 'ESOCKET') {
    return `Secure connection to${host || ' the mail server'} failed for ${label}. Try switching between SSL (port 465/993) and STARTTLS (port 587). Details: ${raw.slice(0, 140)}`;
  }
  if (e.responseCode === 550 || e.responseCode === 553 || /mailbox unavailable|user unknown|no such user|does not exist/i.test(raw)) {
    return `The recipient address was rejected by the mail server. ${raw.slice(0, 160)}`;
  }
  if (e.responseCode === 554 || /spam|blocked|blacklist|policy/i.test(raw)) return `The mail server refused the message as spam or by policy. ${raw.slice(0, 160)}`;
  if (/rate|too many|quota|limit exceeded|daily user sending/i.test(raw)) return `The mail provider says the sending limit was reached. ${raw.slice(0, 160)}`;
  return raw ? `Mail error while ${label}: ${raw.slice(0, 220)}` : `Mail error while ${label}.`;
}

/** True for SMTP failures that will never succeed for this recipient (bad address), as opposed to transient ones. */
export function isPermanentRecipientFailure(error: unknown): boolean {
  const e = (error ?? {}) as ErrLike & { rejected?: string[] };
  const rc = e.responseCode ?? 0;
  if (rc >= 550 && rc <= 553) return true;
  if (rc === 554 && /no valid recipients|user|mailbox|address/i.test(e.response ?? '')) return true;
  return /user unknown|no such user|mailbox unavailable|does not exist|invalid recipient|recipient address rejected/i.test(e.response ?? e.message ?? '');
}

export function isAuthFailure(error: unknown): boolean {
  const e = (error ?? {}) as ErrLike;
  return e.code === 'EAUTH' || e.responseCode === 535 || e.responseCode === 534 || !!e.authenticationFailed || /AUTHENTICATIONFAILED|invalid_grant|unauthorized_client/i.test(e.message ?? '');
}
