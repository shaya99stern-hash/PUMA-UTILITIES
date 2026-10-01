import { z } from 'zod';
import { requireMember } from '@/lib/server/auth';
import { ApiError, json, route } from '@/lib/server/http';
import { readBody } from '@/lib/email/api';
import { loadMailbox } from '@/lib/email/mailboxes';
import { sampleRecipient, sendTestEmail, settingsFor } from '@/lib/email/campaigns';
import { requestOrigin } from '@/lib/email/oauth';
import { campaignSettingsSchema } from '@/lib/email/settings';
import { loadWorkspaceEmail } from '@/lib/email/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  steps: z.array(z.object({ subject: z.string().max(300).default(''), bodyHtml: z.string().max(100_000).default('') })).min(1).max(10),
  stepIndex: z.number().int().min(0).max(9).default(0),
  mailboxId: z.string().uuid(),
  to: z.string().trim().toLowerCase().email().optional(),
  contactId: z.string().uuid().optional(),
  settings: campaignSettingsSchema.partial().optional(),
});

/** Sends one step to yourself, with merge tags filled from a sample (or chosen) contact. */
export const POST = route(async (request) => {
  const ctx = await requireMember();
  const body = await readBody(request, schema);
  const mailbox = await loadMailbox(ctx.workspaceId, body.mailboxId);
  const workspace = await loadWorkspaceEmail(ctx.workspaceId);
  const to = body.to ?? ctx.email ?? mailbox.email;
  if (!to) throw new ApiError(400, 'Enter an address to send the test to.');
  const result = await sendTestEmail({
    workspaceId: ctx.workspaceId,
    steps: body.steps.map((s) => ({ subject: s.subject, body_html: s.bodyHtml })),
    stepIndex: Math.min(body.stepIndex, body.steps.length - 1),
    settings: settingsFor({ settings: body.settings ?? {} }, mailbox, workspace.defaults),
    mailbox,
    recipient: await sampleRecipient(ctx.workspaceId, { contactId: body.contactId }),
    origin: requestOrigin(request),
    to,
  });
  return json(result);
});
