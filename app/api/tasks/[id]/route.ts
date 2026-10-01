import { requireMember } from '@/lib/server/auth';
import { ApiError, json, readJson, route } from '@/lib/server/http';
import { sql } from '@/lib/server/db';
import { logActivity } from '@/lib/crm/activity';
import { taskPatchSchema } from '@/lib/crm/schemas';
import { getId, patchRow, syncFollowUp, type IdContext } from '@/lib/crm/server';
import type { TaskRow } from '@/lib/crm/types';

export const runtime = 'nodejs';

export const PATCH = route<IdContext>(async (request, context) => {
  const ctx = await requireMember();
  const id = await getId(context);
  const body = await readJson(request, taskPatchSchema);
  const db = sql();
  const before = await db<TaskRow[]>`select * from tasks where id = ${id} and workspace_id = ${ctx.workspaceId}`;
  if (!before[0]) throw new ApiError(404, 'Task not found.');
  const patch: Record<string, unknown> = { ...body };
  if (typeof patch.due_at === 'string') patch.due_at = new Date(patch.due_at as string);
  if (body.status === 'done' && before[0].status !== 'done') patch.completed_at = new Date();
  if (body.status === 'open') patch.completed_at = null;
  const row = await patchRow<TaskRow>(db, 'tasks', id, ctx.workspaceId, patch);
  if (!row) throw new ApiError(404, 'Task not found.');
  if (body.status === 'done' && before[0].status !== 'done') {
    await logActivity({
      workspaceId: ctx.workspaceId, companyId: row.company_id, contactId: row.contact_id, propertyId: row.property_id,
      type: 'task_done', subject: `Completed: ${row.title}`, meta: { task_id: row.id, task_type: row.type }, userId: ctx.userId,
    });
  }
  await syncFollowUp(db, ctx.workspaceId, row.company_id);
  if (before[0].company_id && before[0].company_id !== row.company_id) await syncFollowUp(db, ctx.workspaceId, before[0].company_id);
  return json({ task: row });
});

export const DELETE = route<IdContext>(async (_request, context) => {
  const ctx = await requireMember();
  const id = await getId(context);
  const db = sql();
  const rows = await db<{ company_id: string | null }[]>`delete from tasks where id = ${id} and workspace_id = ${ctx.workspaceId} returning company_id`;
  if (!rows.length) throw new ApiError(404, 'Task not found.');
  await syncFollowUp(db, ctx.workspaceId, rows[0].company_id);
  return json({ ok: true, id });
});
