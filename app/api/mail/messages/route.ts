import { sql } from '@/lib/server/db';
import { requireMember } from '@/lib/server/auth';
import { intParam, json, route, searchParams } from '@/lib/server/http';
import { isUuid } from '@/lib/email/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ThreadRow = {
  thread_key: string;
  mailbox_id: string;
  last_at: Date;
  message_count: number;
  unread_count: number;
  last_id: string;
  company_id: string | null;
  contact_id: string | null;
  campaign_id: string | null;
};

/** Thread list. folder=inbox lists threads with received mail, folder=sent threads with sent mail. */
export const GET = route(async (request) => {
  const ctx = await requireMember();
  const p = searchParams(request);
  const db = sql();
  const folder = p.get('folder') === 'sent' ? 'sent' : 'inbox';
  const direction = folder === 'sent' ? 'out' : 'in';
  const mailboxId = isUuid(p.get('mailboxId')) ? p.get('mailboxId') : null;
  const companyId = isUuid(p.get('companyId')) ? p.get('companyId') : null;
  const contactId = isUuid(p.get('contactId')) ? p.get('contactId') : null;
  const q = p.get('q')?.trim();
  const like = q ? `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
  const limit = intParam(p.get('limit'), 40, 1, 100);
  const offset = intParam(p.get('offset'), 0, 0, 10_000);
  const unreadOnly = p.get('unread') === '1';

  const threads = await db<ThreadRow[]>`
    select coalesce(m.thread_key, m.id::text) as thread_key, m.mailbox_id,
      max(m.sent_at) filter (where m.direction = ${direction}) as last_at,
      count(*)::int as message_count,
      (count(*) filter (where m.direction = 'in' and not m.is_read))::int as unread_count,
      (array_agg(m.id order by m.sent_at desc) filter (where m.direction = ${direction}))[1] as last_id,
      (array_agg(m.company_id) filter (where m.company_id is not null))[1] as company_id,
      (array_agg(m.contact_id) filter (where m.contact_id is not null))[1] as contact_id,
      (array_agg(m.campaign_id) filter (where m.campaign_id is not null))[1] as campaign_id
    from email_messages m
    where m.workspace_id = ${ctx.workspaceId}
      ${mailboxId ? db`and m.mailbox_id = ${mailboxId}` : db``}
      ${companyId ? db`and m.company_id = ${companyId}` : db``}
      ${contactId ? db`and m.contact_id = ${contactId}` : db``}
      ${like ? db`and (m.subject ilike ${like} or m.from_email::text ilike ${like} or m.from_name ilike ${like} or m.body_text ilike ${like} or array_to_string(m.to_emails, ' ') ilike ${like})` : db``}
    group by coalesce(m.thread_key, m.id::text), m.mailbox_id
    having bool_or(m.direction = ${direction}) ${unreadOnly ? db`and count(*) filter (where m.direction = 'in' and not m.is_read) > 0` : db``}
    order by last_at desc
    limit ${limit} offset ${offset}`;

  if (!threads.length) return json({ threads: [], folder });

  const lastIds = threads.map((t) => t.last_id);
  const messages = await db<{ id: string; subject: string | null; snippet: string | null; from_email: string | null; from_name: string | null; to_emails: string[]; sent_at: Date; direction: string }[]>`
    select id, subject, snippet, from_email::text as from_email, from_name, to_emails, sent_at, direction from email_messages where id = any(${lastIds}::uuid[])`;
  const byId = new Map(messages.map((m) => [m.id, m]));
  const companyIds = [...new Set(threads.map((t) => t.company_id).filter(Boolean))] as string[];
  const contactIds = [...new Set(threads.map((t) => t.contact_id).filter(Boolean))] as string[];
  const companies = companyIds.length ? await db<{ id: string; name: string; stage: string }[]>`select id, name, stage from companies where id = any(${companyIds}::uuid[])` : [];
  const contacts = contactIds.length ? await db<{ id: string; full_name: string }[]>`select id, full_name from contacts where id = any(${contactIds}::uuid[])` : [];
  const campaignIds = [...new Set(threads.map((t) => t.campaign_id).filter(Boolean))] as string[];
  const campaigns = campaignIds.length ? await db<{ id: string; name: string }[]>`select id, name from campaigns where id = any(${campaignIds}::uuid[])` : [];

  return json({
    folder,
    threads: threads.map((t) => {
      const m = byId.get(t.last_id);
      const company = companies.find((c) => c.id === t.company_id);
      return {
        threadKey: t.thread_key,
        mailboxId: t.mailbox_id,
        subject: m?.subject || '(no subject)',
        snippet: m?.snippet ?? '',
        fromEmail: m?.from_email ?? null,
        fromName: m?.from_name ?? null,
        to: m?.to_emails ?? [],
        lastAt: t.last_at,
        messageCount: t.message_count,
        unread: t.unread_count,
        company: company ? { id: company.id, name: company.name, stage: company.stage } : null,
        contact: contacts.find((c) => c.id === t.contact_id) ? { id: t.contact_id, name: contacts.find((c) => c.id === t.contact_id)!.full_name } : null,
        campaign: campaigns.find((c) => c.id === t.campaign_id) ?? null,
      };
    }),
  });
});
