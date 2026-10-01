import { z } from 'zod';
import { sql } from '@/lib/server/db';
import { requireMember } from '@/lib/server/auth';
import { intParam, json, route, searchParams } from '@/lib/server/http';
import { type IdContext, readBody } from '@/lib/email/api';
import { audienceFilterSchema, insertRecipients, searchAudience, seedFromRow, seedsFromText, type RecipientSeed } from '@/lib/email/audience';
import { loadCampaign, scheduleWaiting, settingsFor } from '@/lib/email/campaigns';
import { loadMailbox } from '@/lib/email/mailboxes';
import { refreshCampaignStats } from '@/lib/email/stats';
import { loadWorkspaceEmail } from '@/lib/email/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = route<IdContext>(async (request, { params }) => {
  const ctx = await requireMember();
  const { id } = await params;
  await loadCampaign(ctx.workspaceId, id);
  const p = searchParams(request);
  const db = sql();
  const status = p.get('status');
  const q = p.get('q')?.trim();
  const like = q ? `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
  const rows = await db`
    select r.id, r.email::text as email, r.first_name, r.last_name, r.company_name, r.company_id, r.contact_id, r.status, r.current_step, r.next_send_at, r.last_sent_at,
      r.opened_at, r.open_count, r.clicked_at, r.click_count, r.replied_at, r.bounced_at, r.unsubscribed_at, r.error
    from campaign_recipients r
    where r.campaign_id = ${id}
      ${status && status !== 'all' ? (status === 'opened' ? db`and r.opened_at is not null` : status === 'clicked' ? db`and r.clicked_at is not null` : db`and r.status = ${status}`) : db``}
      ${like ? db`and (r.email::text ilike ${like} or r.company_name ilike ${like} or r.first_name ilike ${like} or r.last_name ilike ${like})` : db``}
    order by coalesce(r.last_sent_at, r.next_send_at, r.created_at) desc
    limit ${intParam(p.get('limit'), 100, 1, 500)} offset ${intParam(p.get('offset'), 0, 0, 100_000)}`;
  const counts = await db<{ status: string; n: number }[]>`select status, count(*)::int as n from campaign_recipients where campaign_id = ${id} group by status`;
  return json({ recipients: rows, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) });
});

const schema = z.object({
  contactIds: z.array(z.string().uuid()).max(20_000).optional(),
  companyIds: z.array(z.string().uuid()).max(20_000).optional(),
  filter: audienceFilterSchema.optional(),
  decisionMakersOnly: z.boolean().optional(),
  emails: z.array(z.string()).max(20_000).optional(),
  csv: z.string().max(3_000_000).optional(),
});

/** Adds recipients by contact, by company (all contacts with email, or decision makers only), or pasted emails / CSV. */
export const POST = route<IdContext>(async (request, { params }) => {
  const ctx = await requireMember();
  const { id } = await params;
  const campaign = await loadCampaign(ctx.workspaceId, id);
  const a = await readBody(request, schema);
  const seeds: RecipientSeed[] = [];
  if (a.contactIds?.length || a.companyIds?.length || a.filter) {
    const res = await searchAudience(ctx.workspaceId, { contactIds: a.contactIds, companyIds: a.companyIds, filter: { ...a.filter, decisionMakersOnly: a.decisionMakersOnly ?? a.filter?.decisionMakersOnly } }, { limit: 20_000 });
    seeds.push(...res.rows.map(seedFromRow));
  }
  const pasted = seedsFromText({ emails: a.emails, csv: a.csv });
  seeds.push(...pasted.seeds);
  const result = await insertRecipients(ctx.workspaceId, id, seeds, { invalid: pasted.invalid });

  // A running campaign picks up late additions at the back of the queue.
  if (result.added && ['sending', 'completed'].includes(campaign.status)) {
    const mailbox = campaign.mailbox_id ? await loadMailbox(ctx.workspaceId, campaign.mailbox_id).catch(() => null) : null;
    const workspace = await loadWorkspaceEmail(ctx.workspaceId);
    await scheduleWaiting(campaign, settingsFor(campaign, mailbox, workspace.defaults));
    if (campaign.status === 'completed') await sql()`update campaigns set status = 'sending', completed_at = null where id = ${id}`;
  }
  await refreshCampaignStats(id);
  return json(result, 201);
});
