import { sql } from '@/lib/server/db';
import { requireMember } from '@/lib/server/auth';
import { ApiError, json, route, searchParams } from '@/lib/server/http';
import { isUuid } from '@/lib/email/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Message = {
  id: string;
  mailbox_id: string;
  direction: 'in' | 'out';
  message_id_header: string | null;
  from_email: string | null;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  sent_at: Date;
  is_read: boolean;
  contact_id: string | null;
  company_id: string | null;
  campaign_id: string | null;
  recipient_id: string | null;
};

export const GET = route<{ params: Promise<{ threadKey: string }> }>(async (request, { params }) => {
  const ctx = await requireMember();
  const { threadKey } = await params;
  const p = searchParams(request);
  const mailboxId = isUuid(p.get('mailboxId')) ? p.get('mailboxId') : null;
  const db = sql();
  const key = decodeURIComponent(threadKey);

  const messages = await db<Message[]>`
    select id, mailbox_id, direction, message_id_header, from_email::text as from_email, from_name, to_emails, cc_emails, subject, body_text, body_html,
           sent_at, is_read, contact_id, company_id, campaign_id, recipient_id
    from email_messages
    where workspace_id = ${ctx.workspaceId} and (thread_key = ${key} or id::text = ${key})
      ${mailboxId ? db`and mailbox_id = ${mailboxId}` : db``}
    order by sent_at`;
  if (!messages.length) throw new ApiError(404, 'Conversation not found.');

  if (p.get('markRead') === '1') {
    await db`update email_messages set is_read = true where workspace_id = ${ctx.workspaceId} and id = any(${messages.filter((m) => !m.is_read).map((m) => m.id)}::uuid[])`;
  }

  const companyId = messages.find((m) => m.company_id)?.company_id ?? null;
  const contactId = messages.find((m) => m.contact_id)?.contact_id ?? null;
  const campaignId = messages.find((m) => m.campaign_id)?.campaign_id ?? null;
  const company = companyId ? (await db<{ id: string; name: string; stage: string; city: string | null; state: string | null }[]>`select id, name, stage, city, state from companies where id = ${companyId}`)[0] : null;
  const contact = contactId ? (await db<{ id: string; full_name: string; title: string | null; email: string | null }[]>`select id, full_name, title, email::text as email from contacts where id = ${contactId}`)[0] : null;
  const campaign = campaignId ? (await db<{ id: string; name: string }[]>`select id, name from campaigns where id = ${campaignId}`)[0] : null;
  const mailbox = (await db<{ id: string; email: string; display_name: string | null }[]>`select id, email::text as email, display_name from mailboxes where id = ${messages[0].mailbox_id}`)[0] ?? null;

  return json({
    threadKey: key,
    subject: messages[messages.length - 1].subject || messages[0].subject || '(no subject)',
    mailbox,
    company,
    contact,
    campaign,
    messages: messages.map((m) => ({ ...m, is_read: m.is_read || p.get('markRead') === '1' })),
  });
});
