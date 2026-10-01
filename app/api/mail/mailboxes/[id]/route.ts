import { z } from 'zod';
import { encryptSecret } from '@/lib/server/crypto';
import { sql } from '@/lib/server/db';
import { requireMember } from '@/lib/server/auth';
import { ApiError, json, route } from '@/lib/server/http';
import { type IdContext, readBody } from '@/lib/email/api';
import { loadMailbox, publicMailbox, type MailboxRow } from '@/lib/email/mailboxes';
import { sanitizeEmailHtml } from '@/lib/email/merge';
import { smtpImapProvider } from '@/lib/email/providers/smtp-imap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const endpoint = z.object({ host: z.string().trim().min(1).max(253), port: z.number().int().min(1).max(65535), secure: z.boolean() });
const schema = z.object({
  displayName: z.string().trim().max(120).nullable().optional(),
  dailyLimit: z.number().int().min(1).max(2000).optional(),
  signatureHtml: z.string().max(20000).nullable().optional(),
  password: z.string().min(1).max(500).optional(),
  username: z.string().trim().max(254).optional(),
  smtp: endpoint.optional(),
  imap: endpoint.optional(),
  status: z.enum(['active', 'disconnected']).optional(),
});

export const PATCH = route<IdContext>(async (request, { params }) => {
  const ctx = await requireMember();
  const { id } = await params;
  const mailbox = await loadMailbox(ctx.workspaceId, id);
  const body = await readBody(request, schema);
  const db = sql();

  let secret = mailbox.secret_enc;
  const credentialsChanged = body.password || body.smtp || body.imap || body.username;
  if (credentialsChanged && mailbox.provider === 'smtp_imap') {
    const { decryptSecret } = await import('@/lib/server/crypto');
    const appPassword = /gmail|icloud|yahoo|zoho|office365/i.test(body.smtp?.host ?? mailbox.smtp_host ?? '');
    const password = body.password ? (appPassword ? body.password.replace(/\s+/g, '') : body.password) : decryptSecret(mailbox.secret_enc ?? '');
    const smtp = body.smtp ?? { host: mailbox.smtp_host ?? '', port: mailbox.smtp_port ?? 587, secure: mailbox.smtp_secure ?? false };
    const imap = body.imap ?? { host: mailbox.imap_host ?? '', port: mailbox.imap_port ?? 993, secure: mailbox.imap_secure ?? true };
    const test = await smtpImapProvider({ email: mailbox.email, username: body.username || mailbox.username || mailbox.email, password, smtp, imap, appPassword }).verify();
    if (!test.ok) throw new ApiError(422, test.error ?? 'Could not connect with these details.', { smtp: test.smtp, imap: test.imap });
    secret = encryptSecret(password);
    await db`update mailboxes set smtp_host = ${smtp.host}, smtp_port = ${smtp.port}, smtp_secure = ${smtp.secure}, imap_host = ${imap.host}, imap_port = ${imap.port}, imap_secure = ${imap.secure},
             username = ${body.username || mailbox.username}, secret_enc = ${secret}, status = 'active', last_error = null where id = ${mailbox.id}`;
  }

  const rows = await db<MailboxRow[]>`
    update mailboxes set
      display_name = ${body.displayName === undefined ? mailbox.display_name : body.displayName || null},
      daily_limit = ${body.dailyLimit ?? mailbox.daily_limit},
      signature_html = ${body.signatureHtml === undefined ? mailbox.signature_html : body.signatureHtml ? sanitizeEmailHtml(body.signatureHtml) : null},
      status = ${body.status ?? (credentialsChanged ? 'active' : mailbox.status)}
    where id = ${mailbox.id} returning *`;
  return json({ mailbox: publicMailbox(rows[0]) });
});

/** Removes the mailbox and its synced messages; running campaigns that use it are paused. */
export const DELETE = route<IdContext>(async (_request, { params }) => {
  const ctx = await requireMember('admin');
  const { id } = await params;
  const mailbox = await loadMailbox(ctx.workspaceId, id);
  const db = sql();
  await db`update campaigns set status = 'paused' where mailbox_id = ${mailbox.id} and status = 'sending'`;
  await db`delete from mailboxes where id = ${mailbox.id}`;
  return json({ ok: true });
});
