import { requireMember } from '@/lib/server/auth';
import { ApiError, json, readJson, route } from '@/lib/server/http';
import { sql } from '@/lib/server/db';
import { assertCompany, prepareContactFields, throwContactConflict } from '@/lib/crm/contacts';
import { contactPatchSchema } from '@/lib/crm/schemas';
import { getId, patchRow, type IdContext } from '@/lib/crm/server';
import type { ActivityListRow, CompanyRow, ContactRow, TaskRow } from '@/lib/crm/types';

export const runtime = 'nodejs';

export const GET = route<IdContext>(async (_request, context) => {
  const ctx = await requireMember();
  const id = await getId(context);
  const db = sql();
  const rows = await db<ContactRow[]>`select * from contacts where id = ${id} and workspace_id = ${ctx.workspaceId}`;
  if (!rows[0]) throw new ApiError(404, 'Contact not found.');
  const contact = rows[0];
  const [company, activities, tasks] = await Promise.all([
    contact.company_id
      ? db<CompanyRow[]>`select id, name, stage, domain, website, city, state, score, portfolio_units, portfolio_buildings from companies where id = ${contact.company_id} and workspace_id = ${ctx.workspaceId}`
      : Promise.resolve([]),
    db<ActivityListRow[]>`
      select a.*, pr.full_name as author_name from activities a left join profiles pr on pr.user_id = a.created_by
      where a.contact_id = ${id} and a.workspace_id = ${ctx.workspaceId} order by a.occurred_at desc limit 100`,
    db<TaskRow[]>`select * from tasks where contact_id = ${id} and workspace_id = ${ctx.workspaceId} and status = 'open' order by due_at asc nulls last`,
  ]);
  return json({ contact, company: company[0] ?? null, activities, tasks });
});

export const PATCH = route<IdContext>(async (request, context) => {
  const ctx = await requireMember();
  const id = await getId(context);
  const { tags, ...rest } = await readJson(request, contactPatchSchema);
  const db = sql();
  const existing = await db<ContactRow[]>`select * from contacts where id = ${id} and workspace_id = ${ctx.workspaceId}`;
  if (!existing[0]) throw new ApiError(404, 'Contact not found.');
  if (rest.company_id) await assertCompany(ctx.workspaceId, rest.company_id as string);
  const fields = prepareContactFields(rest, existing[0]);
  if (fields.email !== undefined && fields.email !== existing[0].email) {
    // A new address starts out unverified again unless the caller says otherwise.
    if (fields.email_status === undefined) fields.email_status = fields.email ? 'unknown' : existing[0].email_status;
    fields.bounced_at = null;
  }
  const patch: Record<string, unknown> = { ...fields };
  if (tags !== undefined) patch.tags = tags;
  try {
    const row = await patchRow<ContactRow>(db, 'contacts', id, ctx.workspaceId, patch, ['tags']);
    return json({ contact: row });
  } catch (error) {
    return await throwContactConflict(error, ctx.workspaceId, fields.email);
  }
});

export const DELETE = route<IdContext>(async (_request, context) => {
  const ctx = await requireMember();
  const id = await getId(context);
  const rows = await sql()`delete from contacts where id = ${id} and workspace_id = ${ctx.workspaceId} returning id`;
  if (!rows.length) throw new ApiError(404, 'Contact not found.');
  return json({ ok: true, id });
});
