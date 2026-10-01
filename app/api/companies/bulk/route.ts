import { z } from 'zod';
import { requireMember } from '@/lib/server/auth';
import { json, readJson, route, ApiError } from '@/lib/server/http';
import { sql } from '@/lib/server/db';
import { logActivity } from '@/lib/crm/activity';
import { stageSchema } from '@/lib/crm/schemas';
import { STAGE_LABELS, type Stage } from '@/lib/crm/types';

export const runtime = 'nodejs';

const bulkSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('stage'), ids: z.array(z.string().uuid()).min(1).max(500), stage: stageSchema }),
  z.object({ action: z.literal('add_tag'), ids: z.array(z.string().uuid()).min(1).max(500), tag: z.string().trim().min(1).max(40) }),
  z.object({ action: z.literal('remove_tag'), ids: z.array(z.string().uuid()).min(1).max(500), tag: z.string().trim().min(1).max(40) }),
  z.object({ action: z.literal('delete'), ids: z.array(z.string().uuid()).min(1).max(500) }),
]);

export const POST = route(async (request) => {
  const ctx = await requireMember();
  const body = await readJson(request, bulkSchema);
  const db = sql();
  const ws = ctx.workspaceId;

  if (body.action === 'delete') {
    const rows = await db`delete from companies where workspace_id = ${ws} and id in ${db(body.ids)} returning id`;
    return json({ ok: true, affected: rows.length });
  }
  if (body.action === 'add_tag') {
    const rows = await db`update companies set tags = array(select distinct unnest(tags || ${body.tag}::text)) where workspace_id = ${ws} and id in ${db(body.ids)} returning id`;
    return json({ ok: true, affected: rows.length });
  }
  if (body.action === 'remove_tag') {
    const rows = await db`update companies set tags = array_remove(tags, ${body.tag}) where workspace_id = ${ws} and id in ${db(body.ids)} returning id`;
    return json({ ok: true, affected: rows.length });
  }
  if (body.action === 'stage') {
    const before = await db<{ id: string; stage: Stage }[]>`select id, stage from companies where workspace_id = ${ws} and id in ${db(body.ids)}`;
    const changing = before.filter((r) => r.stage !== body.stage);
    if (changing.length) {
      await db`update companies set stage = ${body.stage} where workspace_id = ${ws} and id in ${db(changing.map((r) => r.id))}`;
      for (const row of changing) {
        await logActivity({
          workspaceId: ws, companyId: row.id, type: 'stage_change', userId: ctx.userId,
          subject: `Moved from ${STAGE_LABELS[row.stage]} to ${STAGE_LABELS[body.stage]}`, meta: { from: row.stage, to: body.stage, bulk: true },
        });
      }
    }
    return json({ ok: true, affected: before.length, changed: changing.length });
  }
  throw new ApiError(400, 'Unknown bulk action.');
});
