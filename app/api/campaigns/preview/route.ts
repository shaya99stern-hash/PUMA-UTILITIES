import { z } from 'zod';
import { requireMember } from '@/lib/server/auth';
import { json, route } from '@/lib/server/http';
import { readBody } from '@/lib/email/api';
import { loadMailbox } from '@/lib/email/mailboxes';
import { renderPreview, sampleRecipient, settingsFor } from '@/lib/email/campaigns';
import { requestOrigin } from '@/lib/email/oauth';
import { campaignSettingsSchema } from '@/lib/email/settings';
import { loadWorkspaceEmail } from '@/lib/email/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  steps: z.array(z.object({ subject: z.string().max(300).default(''), bodyHtml: z.string().max(100_000).default('') })).min(1).max(10),
  stepIndex: z.number().int().min(0).max(9).default(0),
  mailboxId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().optional(),
  settings: campaignSettingsSchema.partial().optional(),
});

/** Renders a step from wizard state (before the campaign is saved). */
export const POST = route(async (request) => {
  const ctx = await requireMember();
  const body = await readBody(request, schema);
  const mailbox = body.mailboxId ? await loadMailbox(ctx.workspaceId, body.mailboxId) : null;
  const workspace = await loadWorkspaceEmail(ctx.workspaceId);
  const rendered = await renderPreview({
    workspaceId: ctx.workspaceId,
    steps: body.steps.map((s) => ({ subject: s.subject, body_html: s.bodyHtml })),
    stepIndex: Math.min(body.stepIndex, body.steps.length - 1),
    settings: settingsFor({ settings: body.settings ?? {} }, mailbox, workspace.defaults),
    mailbox,
    recipient: await sampleRecipient(ctx.workspaceId, { contactId: body.contactId }),
    origin: requestOrigin(request),
  });
  return json(rendered);
});
