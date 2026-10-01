import { z } from 'zod';
import { sql } from '@/lib/server/db';
import { requireMember } from '@/lib/server/auth';
import { ApiError, json, route } from '@/lib/server/http';
import { type IdContext, readBody } from '@/lib/email/api';
import { baseUrlFrom } from '@/lib/email/compliance';
import { loadCampaign, loadSteps, readiness, settingsFor } from '@/lib/email/campaigns';
import { loadMailbox } from '@/lib/email/mailboxes';
import { requestOrigin } from '@/lib/email/oauth';
import { campaignSettingsSchema } from '@/lib/email/settings';
import { computeCampaignStats } from '@/lib/email/stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<IdContext>(async (request, { params }) => {
  const ctx = await requireMember();
  const { id } = await params;
  const campaign = await loadCampaign(ctx.workspaceId, id);
  const [steps, stats, ready] = await Promise.all([loadSteps(id), computeCampaignStats(id), readiness(campaign, baseUrlFrom(requestOrigin(request)))]);
  const mailbox = ready.mailbox;
  return json({
    campaign: {
      ...campaign,
      settings: settingsFor(campaign, mailbox, ready.workspace.defaults),
      mailbox: mailbox ? { id: mailbox.id, email: mailbox.email, status: mailbox.status, dailyLimit: mailbox.daily_limit, displayName: mailbox.display_name } : null,
      lastError: (campaign.stats as Record<string, unknown>)?.lastError ?? null,
    },
    steps,
    stats,
    readiness: ready.issues,
  });
});

const schema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  mailboxId: z.string().uuid().nullable().optional(),
  settings: campaignSettingsSchema.partial().optional(),
});

export const PATCH = route<IdContext>(async (request, { params }) => {
  const ctx = await requireMember();
  const { id } = await params;
  const campaign = await loadCampaign(ctx.workspaceId, id);
  const body = await readBody(request, schema);
  const db = sql();
  let mailboxId = campaign.mailbox_id;
  if (body.mailboxId !== undefined) mailboxId = body.mailboxId ? (await loadMailbox(ctx.workspaceId, body.mailboxId)).id : null;
  const mailbox = mailboxId ? await loadMailbox(ctx.workspaceId, mailboxId) : null;
  const settings = body.settings ? settingsFor({ settings: { ...campaign.settings, ...body.settings } }, mailbox) : campaign.settings;
  await db`update campaigns set name = ${body.name ?? campaign.name}, mailbox_id = ${mailboxId}, settings = ${db.json(settings as never)} where id = ${id}`;
  return json({ ok: true });
});

export const DELETE = route<IdContext>(async (_request, { params }) => {
  const ctx = await requireMember();
  const { id } = await params;
  const campaign = await loadCampaign(ctx.workspaceId, id);
  if (campaign.status === 'sending') throw new ApiError(409, 'Pause the campaign before deleting it.');
  await sql()`delete from campaigns where id = ${id}`;
  return json({ ok: true });
});
