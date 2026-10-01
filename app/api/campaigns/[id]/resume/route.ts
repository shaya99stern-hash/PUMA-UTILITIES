import { requireMember } from '@/lib/server/auth';
import { json, route } from '@/lib/server/http';
import { type IdContext } from '@/lib/email/api';
import { baseUrlFrom } from '@/lib/email/compliance';
import { resumeCampaign } from '@/lib/email/campaigns';
import { requestOrigin } from '@/lib/email/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = route<IdContext>(async (request, { params }) => {
  const ctx = await requireMember();
  const { id } = await params;
  return json(await resumeCampaign(ctx.workspaceId, id, baseUrlFrom(requestOrigin(request))));
});
