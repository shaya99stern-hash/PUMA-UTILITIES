import { z } from 'zod';
import { sql } from '@/lib/server/db';
import { requireMember } from '@/lib/server/auth';
import { json, route } from '@/lib/server/http';
import { readBody } from '@/lib/email/api';
import { audienceFilterSchema, insertRecipients, searchAudience, seedFromRow, seedsFromText, type RecipientSeed } from '@/lib/email/audience';
import { loadMailbox } from '@/lib/email/mailboxes';
import { replaceSteps, settingsFor } from '@/lib/email/campaigns';
import { campaignSettingsSchema } from '@/lib/email/settings';
import { refreshCampaignStats } from '@/lib/email/stats';
import { loadWorkspaceEmail } from '@/lib/email/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = route(async () => {
  const ctx = await requireMember();
  const rows = await sql()`
    select c.id, c.name, c.status, c.mailbox_id, m.email::text as mailbox_email, c.created_at, c.started_at, c.completed_at, c.scheduled_at,
      coalesce(s.total, 0)::int as total, coalesce(s.contacted, 0)::int as contacted, coalesce(s.opened, 0)::int as opened, coalesce(s.clicked, 0)::int as clicked,
      coalesce(s.replied, 0)::int as replied, coalesce(s.bounced, 0)::int as bounced, coalesce(s.unsubscribed, 0)::int as unsubscribed, coalesce(s.queued, 0)::int as queued,
      (select count(*)::int from campaign_steps st where st.campaign_id = c.id) as steps,
      c.stats->>'lastError' as last_error
    from campaigns c
    left join mailboxes m on m.id = c.mailbox_id
    left join (
      select campaign_id, count(*) as total, count(*) filter (where last_sent_at is not null) as contacted,
        count(*) filter (where opened_at is not null) as opened, count(*) filter (where clicked_at is not null) as clicked,
        count(*) filter (where replied_at is not null) as replied, count(*) filter (where status = 'bounced') as bounced,
        count(*) filter (where status = 'unsubscribed') as unsubscribed, count(*) filter (where status in ('queued', 'active')) as queued
      from campaign_recipients where workspace_id = ${ctx.workspaceId} group by campaign_id
    ) s on s.campaign_id = c.id
    where c.workspace_id = ${ctx.workspaceId}
    order by c.created_at desc`;
  return json({ campaigns: rows });
});

const stepSchema = z.object({ subject: z.string().max(300).default(''), bodyHtml: z.string().max(100_000).default(''), delayDays: z.number().int().min(0).max(90).default(0) });
const schema = z.object({
  name: z.string().trim().min(1, 'Name your campaign.').max(160),
  mailboxId: z.string().uuid().nullable().optional(),
  settings: campaignSettingsSchema.partial().optional(),
  steps: z.array(stepSchema).max(10).optional(),
  audience: z
    .object({
      contactIds: z.array(z.string().uuid()).max(20_000).optional(),
      companyIds: z.array(z.string().uuid()).max(20_000).optional(),
      filter: audienceFilterSchema.optional(),
      decisionMakersOnly: z.boolean().optional(),
      emails: z.array(z.string()).max(20_000).optional(),
      csv: z.string().max(3_000_000).optional(),
    })
    .optional(),
});

export const POST = route(async (request) => {
  const ctx = await requireMember();
  const body = await readBody(request, schema);
  const db = sql();
  let mailboxId: string | null = null;
  if (body.mailboxId) mailboxId = (await loadMailbox(ctx.workspaceId, body.mailboxId)).id;
  else {
    const first = await db<{ id: string }[]>`select id from mailboxes where workspace_id = ${ctx.workspaceId} and status = 'active' order by created_at limit 1`;
    mailboxId = first[0]?.id ?? null;
  }
  const mailbox = mailboxId ? await loadMailbox(ctx.workspaceId, mailboxId) : null;
  const workspace = await loadWorkspaceEmail(ctx.workspaceId);
  const settings = settingsFor({ settings: body.settings ?? {} }, mailbox, workspace.defaults);

  const created = await db<{ id: string }[]>`
    insert into campaigns (workspace_id, mailbox_id, name, settings, created_by)
    values (${ctx.workspaceId}, ${mailboxId}, ${body.name}, ${db.json(settings as never)}, ${ctx.userId}) returning id`;
  const id = created[0].id;
  try {
    if (body.steps?.length) await replaceSteps(id, body.steps);
    let added = null;
    if (body.audience) {
      const a = body.audience;
      const seeds: RecipientSeed[] = [];
      if (a.contactIds?.length || a.companyIds?.length || a.filter) {
        const res = await searchAudience(ctx.workspaceId, { contactIds: a.contactIds, companyIds: a.companyIds, filter: { ...a.filter, decisionMakersOnly: a.decisionMakersOnly ?? a.filter?.decisionMakersOnly } }, { limit: 20_000 });
        seeds.push(...res.rows.map(seedFromRow));
      }
      const pasted = seedsFromText({ emails: a.emails, csv: a.csv });
      seeds.push(...pasted.seeds);
      added = await insertRecipients(ctx.workspaceId, id, seeds, { invalid: pasted.invalid });
    }
    await refreshCampaignStats(id);
    return json({ id, recipients: added }, 201);
  } catch (error) {
    // Do not leave a half-built draft behind.
    await db`delete from campaigns where id = ${id}`.catch(() => undefined);
    throw error;
  }
});
