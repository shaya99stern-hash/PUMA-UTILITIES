import { z } from 'zod';
import { requireMember } from '@/lib/server/auth';
import { json, route } from '@/lib/server/http';
import { type IdContext } from '@/lib/email/api';
import { baseUrlFrom } from '@/lib/email/compliance';
import { launchCampaign } from '@/lib/email/campaigns';
import { requestOrigin } from '@/lib/email/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({ startAt: z.string().datetime().optional() });

/** Validates readiness (mailbox, address, steps, recipients), spaces the sends, and starts the campaign. */
export const POST = route<IdContext>(async (request, { params }) => {
  const ctx = await requireMember();
  const { id } = await params;
  const body = schema.parse(await request.json().catch(() => ({})));
  const result = await launchCampaign(ctx.workspaceId, id, baseUrlFrom(requestOrigin(request)), { startAt: body.startAt ? new Date(body.startAt) : undefined });
  return json(result);
});
