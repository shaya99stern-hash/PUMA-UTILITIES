import { requireMember } from '@/lib/server/auth';
import { ApiError, json, readJson, route } from '@/lib/server/http';
import { sql } from '@/lib/server/db';
import { assertCompany } from '@/lib/crm/contacts';
import { payablePatchSchema } from '@/lib/crm/schemas';
import { dateOnly, getId, patchRow, type IdContext } from '@/lib/crm/server';
import type { PayableRow } from '@/lib/crm/types';

export const runtime = 'nodejs';

export const PATCH = route<IdContext>(async (request, context) => {
  const ctx = await requireMember();
  const id = await getId(context);
  const body = await readJson(request, payablePatchSchema);
  if (body.company_id) await assertCompany(ctx.workspaceId, body.company_id as string);
  const db = sql();
  const before = await db<PayableRow[]>`select * from payables where id = ${id} and workspace_id = ${ctx.workspaceId}`;
  if (!before[0]) throw new ApiError(404, 'Payable not found.');
  const patch: Record<string, unknown> = { ...body };
  if (body.status === 'paid' && before[0].status !== 'paid') patch.paid_at = new Date();
  if (body.status && body.status !== 'paid') patch.paid_at = null;
  const row = await patchRow<PayableRow>(db, 'payables', id, ctx.workspaceId, patch);
  return json({ payable: row ? { ...row, due_date: dateOnly(row.due_date) } : row });
});

export const DELETE = route<IdContext>(async (_request, context) => {
  const ctx = await requireMember();
  const id = await getId(context);
  const rows = await sql()`delete from payables where id = ${id} and workspace_id = ${ctx.workspaceId} returning id`;
  if (!rows.length) throw new ApiError(404, 'Payable not found.');
  return json({ ok: true, id });
});
