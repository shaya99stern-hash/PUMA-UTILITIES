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
import { detectServers, type ServerCandidate } from '@/lib/email/autodetect';
import type { VerifyResult } from '@/lib/email/types';

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
  preset: z.enum(['auto', 'gmail', 'outlook', 'icloud', 'yahoo', 'zoho', 'godaddy', 'fastmail', 'custom']).default('auto'),
  username: z.string().trim().max(254).optional(),
  password: z.string().min(1, 'Enter the password or app password.').max(500),
  smtp: endpoint.optional(),
  imap: endpoint.optional(),
  dailyLimit: z.number().int().min(1).max(2000).optional(),
  signatureHtml: z.string().max(20000).optional(),
});

/**
 * Connect any mailbox over SMTP/IMAP. With preset 'auto' (default) the server settings are
 * detected from the address. Nothing is saved unless sending works; if sending works but the
 * inbox (IMAP) does not, the mailbox is saved as send-only so campaigns can still go out.
 */
export const POST = route(async (request) => {
  const ctx = await requireMember();
  const body = await readBody(request, schema);
  const username = body.username || body.email;

  let candidates: ServerCandidate[];
  if (body.smtp) {
    candidates = [{ source: 'manual settings', preset: 'custom', smtp: body.smtp, imap: body.imap ?? null, appPassword: false }];
  } else if (body.preset !== 'auto' && body.preset !== 'custom') {
    const p = PRESETS[body.preset as PresetKey];
    candidates = [{ source: p.label, preset: p.key, smtp: p.smtp, imap: p.imap, appPassword: p.appPassword }];
  } else {
    candidates = await detectServers(body.email);
    if (!candidates.length) throw new ApiError(400, 'Could not find mail servers for this address. Enter the SMTP and IMAP details manually.');
  }

  const deadline = Date.now() + 45_000;
  type Choice = { candidate: ServerCandidate; password: string; test: VerifyResult; sendOnly: boolean };
  let chosen: Choice | null = null;
  let sendOnlyFallback: Choice | null = null;
  const tried: { source: string; smtp: string; error?: string }[] = [];
  for (const candidate of candidates) {
    if (Date.now() > deadline) break;
    // App passwords are often displayed in groups ("abcd efgh ijkl mnop").
    const password = candidate.appPassword ? body.password.replace(/\s+/g, '') : body.password;
    const provider = smtpImapProvider({
      email: body.email, username, password, smtp: candidate.smtp,
      imap: candidate.imap ?? { host: '', port: 993, secure: true }, appPassword: candidate.appPassword,
    });
    const test = await provider.verify();
    tried.push({ source: candidate.source, smtp: `${candidate.smtp.host}:${candidate.smtp.port}`, error: test.ok ? undefined : test.error });
    if (test.ok) { chosen = { candidate, password, test, sendOnly: false }; break; }
    if (test.smtp?.ok && !sendOnlyFallback) sendOnlyFallback = { candidate, password, test, sendOnly: true };
    // A definite login rejection on a matching provider will not improve on other hosts.
    if (/password|auth|credential|login/i.test(test.smtp?.error ?? '') && candidate.preset !== 'custom') break;
  }
  chosen = chosen ?? sendOnlyFallback;
  if (!chosen) {
    const last = tried[tried.length - 1];
    throw new ApiError(422, last?.error ?? 'Could not connect to this mailbox.', { tried });
  }

  const { candidate, password, test, sendOnly } = chosen;
  const smtp = candidate.smtp;
  const imap = sendOnly ? null : candidate.imap;
  const db = sql();
  const rows = await db<MailboxRow[]>`
    insert into mailboxes (workspace_id, user_id, provider, email, display_name, smtp_host, smtp_port, smtp_secure, imap_host, imap_port, imap_secure, username, secret_enc, status, last_error, daily_limit, signature_html)
    values (${ctx.workspaceId}, ${ctx.userId}, 'smtp_imap', ${body.email}, ${body.displayName || null}, ${smtp.host}, ${smtp.port}, ${smtp.secure}, ${imap?.host ?? null}, ${imap?.port ?? null}, ${imap?.secure ?? null},
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
  return json({
    mailbox: publicMailbox(rows[0]),
    test,
    detected: { source: candidate.source, smtp: `${smtp.host}:${smtp.port}`, imap: imap ? `${imap.host}:${imap.port}` : null },
    sendOnly,
    warning: sendOnly ? 'Connected for sending. Reading the inbox (IMAP) did not work, so replies will not sync into Puma yet. You can add IMAP details later.' : undefined,
  }, 201);
});
