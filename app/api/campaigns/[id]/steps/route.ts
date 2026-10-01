import { z } from 'zod';
import { requireMember } from '@/lib/server/auth';
import { ApiError, json, route } from '@/lib/server/http';
import { type IdContext, readBody } from '@/lib/email/api';
import { loadCampaign, loadSteps, replaceSteps } from '@/lib/email/campaigns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  steps: z
    .array(z.object({ subject: z.string().max(300).default(''), bodyHtml: z.string().max(100_000).default(''), delayDays: z.number().int().min(0).max(90).default(0) }))
    .min(1, 'Add at least one email.')
    .max(10),
});

/** Replaces the whole sequence. Steps are 0-based; the first step always has no delay. */
export const PUT = route<IdContext>(async (request, { params }) => {
  const ctx = await requireMember();
  const { id } = await params;
  const campaign = await loadCampaign(ctx.workspaceId, id);
  if (['completed', 'canceled'].includes(campaign.status)) throw new ApiError(409, 'This campaign has finished.');
  const body = await readBody(request, schema);
  await replaceSteps(id, body.steps);
  return json({ steps: await loadSteps(id) });
});
