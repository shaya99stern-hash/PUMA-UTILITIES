import { z } from 'zod';
import { requireMember } from '@/lib/server/auth';
import { ApiError, json, route } from '@/lib/server/http';
import { type IdContext, readBody } from '@/lib/email/api';
import { loadCampaign, loadSteps, sampleRecipient, sendTestEmail, settingsFor } from '@/lib/email/campaigns';
import { loadMailbox } from '@/lib/email/mailboxes';
import { requestOrigin } from '@/lib/email/oauth';
import { loadWorkspaceEmail } from '@/lib/email/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({ stepIndex: z.number().int().min(0).default(0), to: z.string().trim().toLowerCase().email().optional(), recipientId: z.string().uuid().optional() });

/** Sends a step to yourself (defaults to the sending mailbox address). */
export const POST = route<IdContext>(async (request, { params }) => {
  const ctx = await requireMember();
  const { id } = await params;
  const body = await readBody(request, schema);
  const campaign = await loadCampaign(ctx.workspaceId, id);
  if (!campaign.mailbox_id) throw new ApiError(400, 'Choose a sending account first.');
  const mailbox = await loadMailbox(ctx.workspaceId, campaign.mailbox_id);
  const steps = await loadSteps(id);
  if (!steps.length) throw new ApiError(400, 'Add an email to the sequence first.');
  const workspace = await loadWorkspaceEmail(ctx.workspaceId);
  const result = await sendTestEmail({
    workspaceId: ctx.workspaceId,
    steps,
    stepIndex: Math.min(body.stepIndex, steps.length - 1),
    settings: settingsFor(campaign, mailbox, workspace.defaults),
    mailbox,
    recipient: await sampleRecipient(ctx.workspaceId, { campaignId: id, recipientId: body.recipientId }),
    origin: requestOrigin(request),
    to: body.to ?? ctx.email ?? mailbox.email,
  });
  return json(result);
});
