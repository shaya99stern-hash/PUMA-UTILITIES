import { requireMember } from '@/lib/server/auth';
import { json, route } from '@/lib/server/http';
import { type IdContext } from '@/lib/email/api';
import { pauseCampaign } from '@/lib/email/campaigns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route<IdContext>(async (_request, { params }) => {
  const ctx = await requireMember();
  const { id } = await params;
  return json(await pauseCampaign(ctx.workspaceId, id));
});
