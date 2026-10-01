import { z } from 'zod';
import { requireMember } from '@/lib/server/auth';
import { json, route } from '@/lib/server/http';
import { type IdContext, readBody } from '@/lib/email/api';
import { loadCampaign, loadSteps, renderPreview, sampleRecipient, settingsFor } from '@/lib/email/campaigns';
import { loadMailbox } from '@/lib/email/mailboxes';
import { requestOrigin } from '@/lib/email/oauth';
import { loadWorkspaceEmail } from '@/lib/email/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ stepIndex: z.number().int().min(0).default(0), recipientId: z.string().uuid().optional() });

/** Renders one step for one recipient (first recipient when none is given). */
export const POST = route<IdContext>(async (request, { params }) => {
  const ctx = await requireMember();
  const { id } = await params;
  const body = await readBody(request, schema);
  const campaign = await loadCampaign(ctx.workspaceId, id);
  const steps = await loadSteps(id);
  const mailbox = campaign.mailbox_id ? await loadMailbox(ctx.workspaceId, campaign.mailbox_id).catch(() => null) : null;
  const workspace = await loadWorkspaceEmail(ctx.workspaceId);
  const rendered = await renderPreview({
    workspaceId: ctx.workspaceId,
    steps,
    stepIndex: Math.min(body.stepIndex, Math.max(0, steps.length - 1)),
    settings: settingsFor(campaign, mailbox, workspace.defaults),
    mailbox,
    recipient: await sampleRecipient(ctx.workspaceId, { campaignId: id, recipientId: body.recipientId }),
    origin: requestOrigin(request),
  });
  return json(rendered);
});
