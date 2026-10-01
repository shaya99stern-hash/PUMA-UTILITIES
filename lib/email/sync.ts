import 'server-only';
import { sql } from '@/lib/server/db';
import { isAuthFailure } from './providers/shared';
import { markMailbox, providerFor, type MailboxRow } from './mailboxes';
import { snippetOf } from './merge';
import { cleanMessageId, detectBounce, isAutoReply, matchReply, normalizeMessageId, threadKeyFor, type ReplyCandidate } from './reply';
import { refreshCampaignStats } from './stats';
import type { Folder, InboundMessage } from './types';

const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com',
  'comcast.net', 'verizon.net', 'optonline.net', 'att.net', 'sbcglobal.net', 'protonmail.com', 'proton.me', 'mail.com', 'gmx.com',
]);

export type SyncResult = { mailboxId: string; email: string; fetched: number; stored: number; replies: number; bounces: number; error?: string };

type Linked = { contactId: string | null; companyId: string | null };

async function linkByEmail(workspaceId: string, address: string | null): Promise<Linked> {
  if (!address) return { contactId: null, companyId: null };
  const db = sql();
  const contacts = await db<{ id: string; company_id: string | null }[]>`
    select id, company_id from contacts where workspace_id = ${workspaceId} and email = ${address} limit 1`;
  if (contacts[0]) return { contactId: contacts[0].id, companyId: contacts[0].company_id };
  const domain = address.split('@')[1]?.toLowerCase();
  if (domain && !FREE_MAIL.has(domain)) {
    const companies = await db<{ id: string }[]>`
      select id from companies where workspace_id = ${workspaceId} and (domain = ${domain} or email = ${address}) limit 2`;
    if (companies.length === 1) return { contactId: null, companyId: companies[0].id };
  } else {
    const companies = await db<{ id: string }[]>`select id from companies where workspace_id = ${workspaceId} and email = ${address} limit 2`;
    if (companies.length === 1) return { contactId: null, companyId: companies[0].id };
  }
  return { contactId: null, companyId: null };
}

/** Thread key: inherit from a known parent message when possible, otherwise compute from headers/subject. */
async function resolveThreadKey(mailbox: MailboxRow, msg: InboundMessage, counterparty: string | null): Promise<string> {
  const ids = [...(msg.references ?? []), ...(msg.inReplyTo ? [msg.inReplyTo] : [])].map(normalizeMessageId).filter(Boolean) as string[];
  if (ids.length) {
    const parent = await sql()<{ thread_key: string | null }[]>`
      select thread_key from email_messages
      where mailbox_id = ${mailbox.id} and lower(message_id_header) = any(${ids}) and thread_key is not null limit 1`;
    if (parent[0]?.thread_key) return parent[0].thread_key;
  }
  return threadKeyFor({ messageId: msg.messageId, inReplyTo: msg.inReplyTo, references: msg.references, subject: msg.subject, counterparty });
}

async function logActivity(args: {
  workspaceId: string;
  companyId: string | null;
  contactId: string | null;
  type: 'email_in' | 'email_out';
  subject: string | null;
  body: string | null;
  occurredAt: Date;
  meta: Record<string, unknown>;
}) {
  if (!args.companyId && !args.contactId) return;
  const db = sql();
  await db`
    insert into activities (workspace_id, company_id, contact_id, type, subject, body, meta, occurred_at)
    values (${args.workspaceId}, ${args.companyId}, ${args.contactId}, ${args.type}, ${args.subject}, ${args.body}, ${db.json(args.meta as never)}, ${args.occurredAt})`;
  if (args.companyId) {
    await db`
      update companies set last_activity_at = greatest(coalesce(last_activity_at, ${args.occurredAt}), ${args.occurredAt}),
        last_contacted_at = case when ${args.type === 'email_out'} then greatest(coalesce(last_contacted_at, ${args.occurredAt}), ${args.occurredAt}) else last_contacted_at end
      where id = ${args.companyId}`;
  }
}

type RecipientRow = { id: string; campaign_id: string; email: string; status: string; contact_id: string | null; company_id: string | null; current_step: number };

/** Applies a received message to campaign recipients (stop sequence, reply event). Returns the matched campaign ids. */
async function applyReply(mailbox: MailboxRow, msg: InboundMessage, storedId: string): Promise<{ campaignIds: string[]; recipientIds: string[] }> {
  const db = sql();
  const ws = mailbox.workspace_id;
  const from = msg.from?.email ?? null;
  const ids = [...(msg.references ?? []), ...(msg.inReplyTo ? [msg.inReplyTo] : [])].map(normalizeMessageId).filter(Boolean) as string[];
  if (!from && !ids.length) return { campaignIds: [], recipientIds: [] };

  const recipients = await db<RecipientRow[]>`
    select r.id, r.campaign_id, r.email::text as email, r.status, r.contact_id, r.company_id, r.current_step
    from campaign_recipients r
    where r.workspace_id = ${ws}
      and r.last_sent_at is not null
      and (
        r.email = ${from ?? ''}
        or r.id in (select recipient_id from email_messages where workspace_id = ${ws} and recipient_id is not null and lower(message_id_header) = any(${ids.length ? ids : ['']}))
      )`;
  if (!recipients.length) return { campaignIds: [], recipientIds: [] };

  const sentIds = await db<{ recipient_id: string; message_id_header: string }[]>`
    select recipient_id, message_id_header from email_messages
    where recipient_id = any(${recipients.map((r) => r.id)}) and direction = 'out' and message_id_header is not null`;
  const candidates: ReplyCandidate[] = recipients.map((r) => ({
    recipientId: r.id,
    email: r.email,
    status: r.status,
    messageIds: sentIds.filter((s) => s.recipient_id === r.id).map((s) => s.message_id_header),
  }));

  const match = matchReply({ fromEmail: from, inReplyTo: msg.inReplyTo, references: msg.references }, candidates);
  if (!match) return { campaignIds: [], recipientIds: [] };

  // A header match targets one recipient; an address match covers every campaign that emailed this person.
  const targets = match.by === 'header' ? recipients.filter((r) => r.id === match.candidate.recipientId) : recipients.filter((r) => r.email.toLowerCase() === (from ?? ''));
  const auto = isAutoReply({ autoSubmitted: msg.autoSubmitted, subject: msg.subject, fromEmail: from });
  const campaignIds: string[] = [];
  const recipientIds: string[] = [];

  for (const r of targets) {
    await db`update email_messages set campaign_id = ${r.campaign_id}, recipient_id = ${r.id} where id = ${storedId} and recipient_id is null`;
    if (auto) continue; // out-of-office and similar do not end a sequence
    const campaign = await db<{ settings: Record<string, unknown> }[]>`select settings from campaigns where id = ${r.campaign_id}`;
    const stop = campaign[0]?.settings?.stopOnReply !== false;
    const updated = await db<{ id: string }[]>`
      update campaign_recipients set
        replied_at = coalesce(replied_at, ${msg.date}),
        status = case when ${stop} and status not in ('unsubscribed', 'bounced') then 'replied' else status end,
        next_send_at = case when ${stop} then null else next_send_at end
      where id = ${r.id} and replied_at is null
      returning id`;
    if (!updated.length) continue;
    await db`
      insert into email_events (workspace_id, campaign_id, recipient_id, type, meta)
      values (${ws}, ${r.campaign_id}, ${r.id}, 'reply', ${db.json({ message_id: storedId, matched_by: match.by, subject: msg.subject, step: Math.max(0, r.current_step - 1) } as never)})`;
    campaignIds.push(r.campaign_id);
    recipientIds.push(r.id);
    if (r.contact_id) await db`update contacts set last_replied_at = ${msg.date} where id = ${r.contact_id}`;
  }
  return { campaignIds, recipientIds };
}

async function applyBounce(mailbox: MailboxRow, msg: InboundMessage, bounce: ReturnType<typeof detectBounce>): Promise<string[]> {
  const db = sql();
  const ws = mailbox.workspace_id;
  const touched: string[] = [];
  const email = bounce.recipientEmail;
  let recipients: { id: string; campaign_id: string; email: string }[] = [];

  if (bounce.originalMessageIds.length) {
    recipients = await db<{ id: string; campaign_id: string; email: string }[]>`
      select r.id, r.campaign_id, r.email::text as email from campaign_recipients r
      where r.workspace_id = ${ws} and r.id in (
        select recipient_id from email_messages where workspace_id = ${ws} and recipient_id is not null and lower(message_id_header) = any(${bounce.originalMessageIds}))`;
  }
  if (!recipients.length && email) {
    recipients = await db<{ id: string; campaign_id: string; email: string }[]>`
      select id, campaign_id, email::text as email from campaign_recipients
      where workspace_id = ${ws} and email = ${email} and last_sent_at is not null`;
  }
  const address = email ?? recipients[0]?.email ?? null;

  for (const r of recipients) {
    await db`
      insert into email_events (workspace_id, campaign_id, recipient_id, type, meta)
      values (${ws}, ${r.campaign_id}, ${r.id}, 'bounce', ${db.json({ permanent: bounce.permanent, reason: bounce.reason } as never)})`;
    if (bounce.permanent) {
      await db`
        update campaign_recipients set status = 'bounced', bounced_at = coalesce(bounced_at, now()), next_send_at = null, error = ${bounce.reason}
        where id = ${r.id} and status not in ('unsubscribed')`;
      touched.push(r.campaign_id);
    }
  }
  if (bounce.permanent && address) {
    await db`insert into suppressions (workspace_id, email, reason) values (${ws}, ${address}, 'bounced') on conflict do nothing`;
    await db`update contacts set bounced_at = coalesce(bounced_at, now()), email_status = 'bounced' where workspace_id = ${ws} and email = ${address}`;
    // Stop any other sequence waiting on this address.
    const others = await db<{ campaign_id: string }[]>`
      update campaign_recipients set status = 'bounced', bounced_at = coalesce(bounced_at, now()), next_send_at = null
      where workspace_id = ${ws} and email = ${address} and status in ('queued', 'active') returning campaign_id`;
    touched.push(...others.map((o) => o.campaign_id));
  }
  return [...new Set(touched)];
}

/** Stores one fetched message and applies reply / bounce logic. Returns what happened. */
export async function ingestMessage(mailbox: MailboxRow, msg: InboundMessage): Promise<{ stored: boolean; reply: boolean; bounce: boolean; campaignIds: string[] }> {
  const db = sql();
  const ws = mailbox.workspace_id;
  const direction = msg.folder === 'sent' ? 'out' : 'in';
  const messageId = cleanMessageId(msg.messageId);
  const messageIdKey = normalizeMessageId(msg.messageId);

  const dup = await db<{ id: string }[]>`
    select id from email_messages
    where mailbox_id = ${mailbox.id} and (provider_id = ${msg.providerId} or (${messageIdKey}::text is not null and lower(message_id_header) = ${messageIdKey}::text))
    limit 1`;
  if (dup.length) return { stored: false, reply: false, bounce: false, campaignIds: [] };

  const own = mailbox.email.toLowerCase();
  const counterparty = direction === 'in' ? (msg.from?.email ?? null) : ((msg.to.find((t) => t !== own) ?? msg.to[0]) ?? null);
  const linked = await linkByEmail(ws, counterparty);
  const threadKey = await resolveThreadKey(mailbox, msg, counterparty);
  const text = (msg.text ?? '').slice(0, 200_000);
  const html = msg.html ? msg.html.slice(0, 400_000) : null;

  const inserted = await db<{ id: string }[]>`
    insert into email_messages (
      workspace_id, mailbox_id, direction, provider_id, message_id_header, thread_key, in_reply_to, references_header,
      from_email, from_name, to_emails, cc_emails, subject, snippet, body_text, body_html, sent_at, is_read, contact_id, company_id
    ) values (
      ${ws}, ${mailbox.id}, ${direction}, ${msg.providerId}, ${messageId}, ${threadKey}, ${cleanMessageId(msg.inReplyTo)}, ${msg.references.join(' ') || null},
      ${msg.from?.email ?? null}, ${msg.from?.name ?? null}, ${db.array(msg.to, 25)}, ${db.array(msg.cc, 25)}, ${msg.subject.slice(0, 500)}, ${snippetOf(text)}, ${text}, ${html}, ${msg.date},
      ${direction === 'out' ? true : msg.isRead}, ${linked.contactId}, ${linked.companyId}
    ) on conflict (mailbox_id, provider_id) do nothing returning id`;
  if (!inserted[0]) return { stored: false, reply: false, bounce: false, campaignIds: [] };
  const storedId = inserted[0].id;

  let reply = false;
  let bounced = false;
  let campaignIds: string[] = [];

  if (direction === 'in') {
    const bounce = detectBounce({ fromEmail: msg.from?.email ?? null, fromName: msg.from?.name, subject: msg.subject, text, ownEmails: [own] });
    if (bounce.isBounce) {
      bounced = true;
      campaignIds = await applyBounce(mailbox, msg, bounce);
      await db`update email_messages set is_read = true where id = ${storedId}`;
    } else {
      const res = await applyReply(mailbox, msg, storedId);
      reply = res.recipientIds.length > 0;
      campaignIds = res.campaignIds;
      if (linked.contactId && !isAutoReply({ autoSubmitted: msg.autoSubmitted, subject: msg.subject })) {
        await db`update contacts set last_replied_at = greatest(coalesce(last_replied_at, ${msg.date}), ${msg.date}) where id = ${linked.contactId}`;
      }
      await logActivity({
        workspaceId: ws,
        companyId: linked.companyId,
        contactId: linked.contactId,
        type: 'email_in',
        subject: msg.subject || '(no subject)',
        body: snippetOf(text, 400),
        occurredAt: msg.date,
        meta: { message_id: storedId, mailbox_id: mailbox.id, thread_key: threadKey, reply_to_campaign: reply },
      });
    }
  } else {
    await logActivity({
      workspaceId: ws,
      companyId: linked.companyId,
      contactId: linked.contactId,
      type: 'email_out',
      subject: msg.subject || '(no subject)',
      body: snippetOf(text, 400),
      occurredAt: msg.date,
      meta: { message_id: storedId, mailbox_id: mailbox.id, thread_key: threadKey, synced: true },
    });
  }
  return { stored: true, reply, bounce: bounced, campaignIds };
}

/** Pulls recent inbox + sent mail for one mailbox. Never throws; failures are recorded on the mailbox. */
export async function syncMailbox(mailbox: MailboxRow, opts: { limit?: number; deadline?: number } = {}): Promise<SyncResult> {
  const db = sql();
  const result: SyncResult = { mailboxId: mailbox.id, email: mailbox.email, fetched: 0, stored: 0, replies: 0, bounces: 0 };
  const limit = opts.limit ?? 40;
  const touched = new Set<string>();
  const state: Record<string, string | null> = { ...(mailbox.sync_state ?? {}) };
  try {
    const provider = providerFor(mailbox);
    const known = new Set(
      (await db<{ provider_id: string }[]>`
        select provider_id from email_messages where mailbox_id = ${mailbox.id} and created_at > now() - interval '30 days' order by created_at desc limit 3000`).map((r) => r.provider_id),
    );
    for (const folder of ['inbox', 'sent'] as Folder[]) {
      if (opts.deadline && Date.now() > opts.deadline) break;
      const listed = await provider.listRecent({ folder, cursor: state[folder] ?? null, limit, known });
      result.fetched += listed.messages.length;
      // Oldest first so replies are matched after the messages they answer.
      const ordered = [...listed.messages].sort((a, b) => a.date.getTime() - b.date.getTime());
      for (const msg of ordered) {
        const r = await ingestMessage(mailbox, msg);
        if (r.stored) result.stored += 1;
        if (r.reply) result.replies += 1;
        if (r.bounce) result.bounces += 1;
        r.campaignIds.forEach((c) => touched.add(c));
      }
      state[folder] = listed.cursor;
    }
    await db`
      update mailboxes set last_sync_at = now(), status = 'active', last_error = null, sync_state = ${db.json(state as never)}
      where id = ${mailbox.id}`;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause ?? error;
    const message = error instanceof Error ? error.message : 'Sync failed.';
    result.error = message;
    await db`update mailboxes set last_sync_at = now(), sync_state = ${db.json(state as never)} where id = ${mailbox.id}`;
    await markMailbox(mailbox.id, isAuthFailure(cause) || isAuthFailure(error) ? 'error' : mailbox.status === 'error' ? 'error' : 'active', message);
  }
  for (const id of touched) await refreshCampaignStats(id).catch(() => undefined);
  return result;
}
