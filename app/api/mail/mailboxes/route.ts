import { z } from 'zod';
import { encryptSecret } from '@/lib/server/crypto';
import { sql } from '@/lib/server/db';
import { requireMember } from '@/lib/server/auth';
import { ApiError, json, route } from '@/lib/server/http';
import { readBody } from '@/lib/email/api';
import { publicMailbox, type MailboxRow } from '@/lib/email/mailboxes';
import { sanitizeEmailHtml } from '@/lib/email/merge';
import { PRESETS, type PresetKey } from '@/lib/email/presets';
import { smtpImapProvider } from '@/lib/email/providers/smtp-imap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = route(async () => {
  const ctx = await requireMember();
  const rows = await sql()<(MailboxRow & { sent_today: number })[]>`
    select m.*, (select count(*)::int from email_events e where e.type = 'sent' and e.created_at > now() - interval '24 hours' and e.meta->>'mailbox_id' = m.id::text) as sent_today
    from mailboxes m where m.workspace_id = ${ctx.workspaceId} order by m.created_at`;
  return json({ mailboxes: rows.map((r) => publicMailbox(r, r.sent_today)) });
});

const endpoint = z.object({ host: z.string().trim().min(1).max(253), port: z.number().int().min(1).max(65535), secure: z.boolean() });
const schema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  displayName: z.string().trim().max(120).optional(),
  preset: z.enum(['gmail', 'outlook', 'icloud', 'yahoo', 'zoho', 'godaddy', 'fastmail', 'custom']).default('custom'),
  username: z.string().trim().max(254).optional(),
  password: z.string().min(1, 'Enter the password or app password.').max(500),
  smtp: endpoint.optional(),
  imap: endpoint.optional(),
  dailyLimit: z.number().int().min(1).max(2000).optional(),
  signatureHtml: z.string().max(20000).optional(),
});

/** Connect a mailbox over SMTP/IMAP. The connection is tested first; nothing is saved when the test fails. */
export const POST = route(async (request) => {
  const ctx = await requireMember();
  const body = await readBody(request, schema);
  const preset = PRESETS[body.preset as PresetKey];
  const smtp = body.smtp ?? (preset.smtp.host ? preset.smtp : null);
  const imap = body.imap ?? (preset.imap.host ? preset.imap : null);
  if (!smtp || !imap) throw new ApiError(400, 'Enter the SMTP and IMAP server details for this provider.');

  // App passwords are often displayed in groups ("abcd efgh ijkl mnop").
  const password = preset.appPassword ? body.password.replace(/\s+/g, '') : body.password;
  const username = body.username || body.email;

  const provider = smtpImapProvider({ email: body.email, username, password, smtp, imap, appPassword: preset.appPassword });
  const test = await provider.verify();
  if (!test.ok) {
    throw new ApiError(422, test.error ?? 'Could not connect to this mailbox.', { smtp: test.smtp, imap: test.imap });
  }

  const db = sql();
  const rows = await db<MailboxRow[]>`
    insert into mailboxes (workspace_id, user_id, provider, email, display_name, smtp_host, smtp_port, smtp_secure, imap_host, imap_port, imap_secure, username, secret_enc, status, last_error, daily_limit, signature_html)
    values (${ctx.workspaceId}, ${ctx.userId}, 'smtp_imap', ${body.email}, ${body.displayName || null}, ${smtp.host}, ${smtp.port}, ${smtp.secure}, ${imap.host}, ${imap.port}, ${imap.secure},
            ${username}, ${encryptSecret(password)}, 'active', null, ${body.dailyLimit ?? 150}, ${body.signatureHtml ? sanitizeEmailHtml(body.signatureHtml) : null})
    on conflict (workspace_id, email) do update set
      provider = 'smtp_imap', display_name = coalesce(excluded.display_name, mailboxes.display_name),
      smtp_host = excluded.smtp_host, smtp_port = excluded.smtp_port, smtp_secure = excluded.smtp_secure,
      imap_host = excluded.imap_host, imap_port = excluded.imap_port, imap_secure = excluded.imap_secure,
      username = excluded.username, secret_enc = excluded.secret_enc, access_token_enc = null, token_expires_at = null,
      status = 'active', last_error = null,
      daily_limit = coalesce(${body.dailyLimit ?? null}, mailboxes.daily_limit),
      signature_html = coalesce(excluded.signature_html, mailboxes.signature_html)
    returning *`;
  return json({ mailbox: publicMailbox(rows[0]), test }, 201);
});
