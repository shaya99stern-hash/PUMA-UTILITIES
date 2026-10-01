import { z } from 'zod';
import { requireMember } from '@/lib/server/auth';
import { json, readJson, route, ApiError } from '@/lib/server/http';
import { sql } from '@/lib/server/db';
import { logActivity } from '@/lib/crm/activity';
import { stageSchema } from '@/lib/crm/schemas';
import { getId, type IdContext } from '@/lib/crm/server';
import { STAGE_LABELS, type CompanyRow } from '@/lib/crm/types';

export const runtime = 'nodejs';

export const POST = route<IdContext>(async (request, context) => {
  const ctx = await requireMember();
  const id = await getId(context);
  const { stage, reason } = await readJson(request, z.object({ stage: stageSchema, reason: z.string().trim().max(500).optional() }));
  const db = sql();
  const current = await db<{ stage: CompanyRow['stage'] }[]>`select stage from companies where id = ${id} and workspace_id = ${ctx.workspaceId}`;
  if (!current[0]) throw new ApiError(404, 'Company not found.');
  const from = current[0].stage;
  if (from === stage) {
    const same = await db<CompanyRow[]>`select * from companies where id = ${id}`;
    return json({ company: same[0], changed: false });
  }
  const rows = await db<CompanyRow[]>`update companies set stage = ${stage} where id = ${id} and workspace_id = ${ctx.workspaceId} returning *`;
  await logActivity({
    workspaceId: ctx.workspaceId, companyId: id, type: 'stage_change', userId: ctx.userId,
    subject: `Moved from ${STAGE_LABELS[from]} to ${STAGE_LABELS[stage]}`, body: reason ?? null, meta: { from, to: stage },
  });
  return json({ company: rows[0], changed: true });
});
