import { z } from 'zod';
import { sql } from '@/lib/server/db';
import { requireMember } from '@/lib/server/auth';
import { ApiError, json, route } from '@/lib/server/http';
import { emailList, isUuid, readBody } from '@/lib/email/api';
import { loadMailbox, sendViaMailbox, senderOf, type MailboxRow } from '@/lib/email/mailboxes';
import { escapeHtml, htmlToText, sanitizeEmailHtml, snippetOf } from '@/lib/email/merge';
import { cleanMessageId, parseMessageIds, threadKeyFor } from '@/lib/email/reply';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  mailboxId: z.string().uuid().optional(),
  to: emailList('To', 25).min(1, 'Add at least one recipient.'),
  cc: emailList('Cc', 25).optional(),
  bcc: emailList('Bcc', 25).optional(),
  subject: z.string().trim().max(500).optional(),
  html: z.string().min(1, 'Write a message first.').max(200_000),
  replyToMessageId: z.string().uuid().optional(),
  includeSignature: z.boolean().default(true),
  quote: z.boolean().default(true),
});

export const POST = route(async (request) => {
  const ctx = await requireMember();
  const body = await readBody(request, schema);
  const db = sql();

  let mailbox: MailboxRow | undefined;
  let parent: { id: string; mailbox_id: string; message_id_header: string | null; references_header: string | null; thread_key: string | null; subject: string | null; from_email: string | null; from_name: string | null; sent_at: Date; body_text: string | null } | undefined;
  if (body.replyToMessageId) {
    parent = (await db<NonNullable<typeof parent>[]>`
      select id, mailbox_id, message_id_header, references_header, thread_key, subject, from_email::text as from_email, from_name, sent_at, body_text
      from email_messages where id = ${body.replyToMessageId} and workspace_id = ${ctx.workspaceId}`)[0];
    if (!parent) throw new ApiError(404, 'The message you are replying to was not found.');
  }
  const mailboxId = body.mailboxId ?? parent?.mailbox_id;
  if (mailboxId && isUuid(mailboxId)) mailbox = await loadMailbox(ctx.workspaceId, mailboxId);
  else {
    mailbox = (await db<MailboxRow[]>`select * from mailboxes where workspace_id = ${ctx.workspaceId} and status = 'active' order by created_at limit 1`)[0];
  }
  if (!mailbox) throw new ApiError(400, 'Connect an email account in Settings > Email first.');
  if (mailbox.status === 'disconnected') throw new ApiError(400, `${mailbox.email} is disconnected. Reconnect it first.`);

  let subject = body.subject?.trim() ?? '';
  if (!subject && parent?.subject) subject = /^re:/i.test(parent.subject) ? parent.subject : `Re: ${parent.subject}`;
  if (!subject) throw new ApiError(400, 'Add a subject.');

  let html = sanitizeEmailHtml(body.html);
  if (body.includeSignature && mailbox.signature_html) html += `<div style="margin-top:16px">${sanitizeEmailHtml(mailbox.signature_html)}</div>`;
  if (parent && body.quote && parent.body_text) {
    const who = parent.from_name ? `${parent.from_name} <${parent.from_email}>` : (parent.from_email ?? 'the sender');
    const quoted = escapeHtml(parent.body_text.trim().slice(0, 6000)).replace(/\n/g, '<br>');
    html += `<br><div style="color:#666">On ${parent.sent_at.toUTCString()}, ${escapeHtml(who)} wrote:</div><blockquote style="margin:6px 0 0 0;padding-left:12px;border-left:2px solid #ccc;color:#666">${quoted}</blockquote>`;
  }
  const text = htmlToText(html);

  const inReplyTo = cleanMessageId(parent?.message_id_header);
  const references = parent ? [...parseMessageIds(parent.references_header), ...(inReplyTo ? [inReplyTo] : [])] : [];
  const uniqueRefs = references.filter((r, i) => references.findIndex((x) => x.toLowerCase() === r.toLowerCase()) === i);

  const sent = await sendViaMailbox(mailbox, {
    from: senderOf(mailbox),
    to: body.to,
    cc: body.cc,
    bcc: body.bcc,
    subject,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f1f1f">${html}</div>`,
    text,
    inReplyTo,
    references: uniqueRefs,
  });

  const messageId = cleanMessageId(sent.messageId) ?? sent.messageId;
  const threadKey = parent?.thread_key ?? threadKeyFor({ messageId, references: uniqueRefs, inReplyTo });
  const firstTo = body.to[0];
  const contact = (await db<{ id: string; company_id: string | null }[]>`select id, company_id from contacts where workspace_id = ${ctx.workspaceId} and email = ${firstTo} limit 1`)[0];
  let companyId = contact?.company_id ?? null;
  if (!companyId) {
    const domain = firstTo.split('@')[1];
    const c = await db<{ id: string }[]>`select id from companies where workspace_id = ${ctx.workspaceId} and (domain = ${domain} or email = ${firstTo}) limit 2`;
    if (c.length === 1) companyId = c[0].id;
  }

  const now = new Date();
  const stored = await db<{ id: string }[]>`
    insert into email_messages (workspace_id, mailbox_id, direction, provider_id, message_id_header, thread_key, in_reply_to, references_header, from_email, from_name,
      to_emails, cc_emails, subject, snippet, body_text, body_html, sent_at, is_read, contact_id, company_id)
    values (${ctx.workspaceId}, ${mailbox.id}, 'out', ${sent.providerId}, ${messageId}, ${threadKey}, ${inReplyTo}, ${uniqueRefs.join(' ') || null}, ${mailbox.email}, ${mailbox.display_name},
      ${db.array(body.to, 25)}, ${db.array(body.cc ?? [], 25)}, ${subject}, ${snippetOf(text)}, ${text}, ${html}, ${now}, true, ${contact?.id ?? null}, ${companyId})
    on conflict (mailbox_id, provider_id) do update set subject = excluded.subject returning id`;
  await db`insert into email_events (workspace_id, type, meta) values (${ctx.workspaceId}, 'sent', ${db.json({ mailbox_id: mailbox.id, manual: true, message_id: messageId } as never)})`;
  if (companyId || contact) {
    await db`
      insert into activities (workspace_id, company_id, contact_id, type, subject, body, meta, occurred_at, created_by)
      values (${ctx.workspaceId}, ${companyId}, ${contact?.id ?? null}, 'email_out', ${subject}, ${snippetOf(text, 400)},
              ${db.json({ message_id: stored[0].id, mailbox_id: mailbox.id, thread_key: threadKey } as never)}, ${now}, ${ctx.userId})`;
    if (companyId) await db`update companies set last_contacted_at = ${now}, last_activity_at = ${now} where id = ${companyId}`;
    if (contact) await db`update contacts set last_contacted_at = ${now} where id = ${contact.id}`;
  }
  return json({ ok: true, id: stored[0].id, threadKey, messageId }, 201);
});
