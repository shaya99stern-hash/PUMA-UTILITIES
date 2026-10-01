import { sql } from '@/lib/server/db';
import { requireMember } from '@/lib/server/auth';
import { json, route } from '@/lib/server/http';
import { isUuid } from '@/lib/email/api';
import { loadCampaign } from '@/lib/email/campaigns';
import { refreshCampaignStats } from '@/lib/email/stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Removes a recipient. If they were already emailed they are kept but marked skipped so history stays intact. */
export const DELETE = route<{ params: Promise<{ id: string; rid: string }> }>(async (_request, { params }) => {
  const ctx = await requireMember();
  const { id, rid } = await params;
  await loadCampaign(ctx.workspaceId, id);
  if (!isUuid(rid)) return json({ ok: true });
  const db = sql();
  const row = await db<{ last_sent_at: Date | null }[]>`select last_sent_at from campaign_recipients where id = ${rid} and campaign_id = ${id}`;
  if (row[0]?.last_sent_at) await db`update campaign_recipients set status = 'skipped', next_send_at = null where id = ${rid}`;
  else await db`delete from campaign_recipients where id = ${rid} and campaign_id = ${id}`;
  await refreshCampaignStats(id);
  return json({ ok: true });
});
