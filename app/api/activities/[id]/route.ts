import { requireMember } from '@/lib/server/auth';
import { ApiError, json, readJson, route } from '@/lib/server/http';
import { sql } from '@/lib/server/db';
import { activityPatchSchema } from '@/lib/crm/schemas';
import { getId, type IdContext } from '@/lib/crm/server';
import { MANUAL_ACTIVITY_TYPES, type ActivityRow } from '@/lib/crm/types';

export const runtime = 'nodejs';

export const PATCH = route<IdContext>(async (request, context) => {
  const ctx = await requireMember();
  const id = await getId(context);
  const body = await readJson(request, activityPatchSchema);
  const db = sql();
  const rows = await db<ActivityRow[]>`
    update activities set
      subject = ${body.subject === undefined ? db`subject` : body.subject},
      body = ${body.body === undefined ? db`body` : body.body},
      occurred_at = ${body.occurred_at ? new Date(body.occurred_at as string) : db`occurred_at`}
    where id = ${id} and workspace_id = ${ctx.workspaceId} and type in ${db([...MANUAL_ACTIVITY_TYPES])}
    returning *`;
  if (!rows[0]) throw new ApiError(404, 'Only notes, calls and meetings can be edited.');
  return json({ activity: rows[0] });
});

export const DELETE = route<IdContext>(async (_request, context) => {
  const ctx = await requireMember();
  const id = await getId(context);
  const rows = await sql()`delete from activities where id = ${id} and workspace_id = ${ctx.workspaceId} and type in ${sql()([...MANUAL_ACTIVITY_TYPES])} returning id`;
  if (!rows.length) throw new ApiError(404, 'Only notes, calls and meetings can be deleted.');
  return json({ ok: true, id });
});
