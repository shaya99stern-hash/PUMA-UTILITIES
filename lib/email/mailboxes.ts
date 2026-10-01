import 'server-only';
import { decryptSecret, encryptSecret } from '@/lib/server/crypto';
import { sql } from '@/lib/server/db';
import { ApiError } from '@/lib/server/http';
import { gmailProvider } from './providers/gmail';
import { microsoftProvider } from './providers/microsoft';
import { smtpImapProvider } from './providers/smtp-imap';
import { isAuthFailure } from './providers/shared';
import { refreshAccessToken, type OAuthKind } from './oauth';
import type { MailProvider, OutgoingMessage, SendResult } from './types';

export type MailboxRow = {
  id: string;
  workspace_id: string;
  user_id: string | null;
  provider: 'smtp_imap' | 'gmail' | 'microsoft';
  email: string;
  display_name: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: boolean | null;
  imap_host: string | null;
  imap_port: number | null;
  imap_secure: boolean | null;
  username: string | null;
  secret_enc: string | null;
  access_token_enc: string | null;
  token_expires_at: Date | null;
  status: 'active' | 'error' | 'disconnected';
  last_error: string | null;
  last_sync_at: Date | null;
  sync_state: Record<string, string | null>;
  daily_limit: number;
  signature_html: string | null;
  created_at: Date;
  updated_at: Date;
};

export type PublicMailbox = Omit<MailboxRow, 'secret_enc' | 'access_token_enc' | 'username'> & { has_secret: boolean; username: string | null; sent_today: number };

export async function loadMailbox(workspaceId: string, id: string): Promise<MailboxRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, 'Mailbox not found.');
  const rows = await sql()<MailboxRow[]>`select * from mailboxes where id = ${id} and workspace_id = ${workspaceId}`;
  if (!rows[0]) throw new ApiError(404, 'Mailbox not found.');
  return rows[0];
}

export function publicMailbox(row: MailboxRow, sentToday = 0): PublicMailbox {
  const { secret_enc, access_token_enc, ...rest } = row;
  return { ...rest, has_secret: !!secret_enc || !!access_token_enc, sent_today: sentToday };
}

/** Returns a valid OAuth access token, refreshing (and persisting) it when it is about to expire. */
async function accessTokenFor(row: MailboxRow): Promise<string> {
  const kind: OAuthKind = row.provider === 'gmail' ? 'google' : 'microsoft';
  if (row.access_token_enc && row.token_expires_at && row.token_expires_at.getTime() > Date.now() + 90_000) {
    return decryptSecret(row.access_token_enc);
  }
  if (!row.secret_enc) throw Object.assign(new Error('This mailbox has no saved sign-in. Reconnect it.'), { code: 'EAUTH' });
  const refresh = decryptSecret(row.secret_enc);
  const token = await refreshAccessToken(kind, refresh);
  const expires = new Date(Date.now() + Math.max(60, token.expires_in) * 1000);
  await sql()`
    update mailboxes set
      access_token_enc = ${encryptSecret(token.access_token)},
      token_expires_at = ${expires},
      secret_enc = ${token.refresh_token ? encryptSecret(token.refresh_token) : row.secret_enc}
    where id = ${row.id}`;
  row.access_token_enc = encryptSecret(token.access_token);
  row.token_expires_at = expires;
  return token.access_token;
}

export function providerFor(row: MailboxRow): MailProvider {
  if (row.provider === 'gmail') return gmailProvider(() => accessTokenFor(row), row.email);
  if (row.provider === 'microsoft') return microsoftProvider(() => accessTokenFor(row), row.email);
  if (!row.secret_enc || !row.smtp_host) throw new ApiError(400, 'This mailbox is missing its connection details. Reconnect it.');
  return smtpImapProvider({
    email: row.email,
    username: row.username || row.email,
    password: decryptSecret(row.secret_enc),
    smtp: { host: row.smtp_host, port: row.smtp_port ?? 587, secure: row.smtp_secure ?? false },
    imap: { host: row.imap_host ?? '', port: row.imap_port ?? 993, secure: row.imap_secure ?? true },
    appPassword: /gmail|googlemail|icloud|me\.com|yahoo|zoho|office365|outlook/i.test(row.smtp_host),
  });
}

export async function markMailbox(id: string, status: 'active' | 'error', error: string | null) {
  await sql()`update mailboxes set status = ${status}, last_error = ${error} where id = ${id}`;
}

/** Sends through the mailbox and records the health of the connection. */
export async function sendViaMailbox(row: MailboxRow, message: OutgoingMessage): Promise<SendResult> {
  try {
    const result = await providerFor(row).send(message);
    if (row.status !== 'active') await markMailbox(row.id, 'active', null);
    return result;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause ?? error;
    if (isAuthFailure(cause) || isAuthFailure(error)) await markMailbox(row.id, 'error', error instanceof Error ? error.message : 'Sign-in failed');
    throw error;
  }
}

export function senderOf(row: Pick<MailboxRow, 'email' | 'display_name'>) {
  return { email: row.email, name: row.display_name };
}

/** Sends in the last 24h from this mailbox (campaign and one-to-one). */
export async function sentLast24h(mailboxId: string): Promise<number> {
  const rows = await sql()<{ n: number }[]>`
    select count(*)::int as n from email_events
    where type = 'sent' and created_at > now() - interval '24 hours' and meta->>'mailbox_id' = ${mailboxId}`;
  return rows[0]?.n ?? 0;
}
