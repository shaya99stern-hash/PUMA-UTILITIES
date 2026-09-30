import { requireMember } from '@/lib/server/auth';
import { json, readJson, route } from '@/lib/server/http';
import { sql } from '@/lib/server/db';
import { getCompanyRow, prepareCompanyFields, throwCompanyConflict } from '@/lib/crm/companies';
import { logActivity } from '@/lib/crm/activity';
import { companyPatchSchema } from '@/lib/crm/schemas';
import { getId, patchRow, type IdContext } from '@/lib/crm/server';
import { ApiError } from '@/lib/server/http';
import { STAGE_LABELS, type Stage, type ActivityListRow, CompanyRow, ContactRow, EvidenceRow, PropertyRow, TaskRow } from '@/lib/crm/types';

export const runtime = 'nodejs';

export const GET = route<IdContext>(async (_request, context) => {
  const ctx = await requireMember();
  const id = await getId(context);
  const db = sql();
  const company = await getCompanyRow(db, ctx.workspaceId, id);
  const [contacts, properties, tasks, activities, evidence, owner] = await Promise.all([
    db<ContactRow[]>`select * from contacts where company_id = ${id} and workspace_id = ${ctx.workspaceId} order by is_decision_maker desc, full_name`,
    db<PropertyRow[]>`select * from properties where company_id = ${id} and workspace_id = ${ctx.workspaceId} order by units desc nulls last, address`,
    db<TaskRow[]>`select * from tasks where company_id = ${id} and workspace_id = ${ctx.workspaceId} and status = 'open' order by due_at asc nulls last, created_at`,
    db<ActivityListRow[]>`
      select a.*, ct.full_name as contact_name, pr.full_name as author_name
      from activities a
      left join contacts ct on ct.id = a.contact_id
      left join profiles pr on pr.user_id = a.created_by
      where a.company_id = ${id} and a.workspace_id = ${ctx.workspaceId}
      order by a.occurred_at desc limit 100`,
    db<EvidenceRow[]>`
      select e.* from evidence e
      where e.workspace_id = ${ctx.workspaceId} and (
        (e.entity_type = 'company' and e.entity_id = ${id})
        or (e.entity_type = 'contact' and e.entity_id in (select id from contacts where company_id = ${id}))
        or (e.entity_type = 'property' and e.entity_id in (select id from properties where company_id = ${id})))
      order by e.retrieved_at desc limit 100`,
    company.owner_user_id
      ? db<{ user_id: string; full_name: string | null; email: string | null }[]>`select user_id, full_name, email from profiles where user_id = ${company.owner_user_id}`
      : Promise.resolve([]),
  ]);
  return json({ company, contacts, properties, tasks, activities, evidence, owner: owner[0] ?? null });
});

export const PATCH = route<IdContext>(async (request, context) => {
  const ctx = await requireMember();
  const id = await getId(context);
  const body = await readJson(request, companyPatchSchema);
  const { tags, ...rest } = body;
  const fields = prepareCompanyFields(rest);
  const patch: Record<string, unknown> = { ...fields };
  if (tags !== undefined) patch.tags = tags;
  const db = sql();
  const before = await getCompanyRow(db, ctx.workspaceId, id);
  let row: CompanyRow | null;
  try {
    row = await patchRow<CompanyRow>(db, 'companies', id, ctx.workspaceId, patch, ['tags']);
  } catch (error) {
    return await throwCompanyConflict(error, ctx, fields, id);
  }
  if (!row) throw new ApiError(404, 'Company not found.');
  if (fields.stage && fields.stage !== before.stage) {
    await logActivity({ workspaceId: ctx.workspaceId, companyId: id, type: 'stage_change', subject: `Moved from ${STAGE_LABELS[before.stage]} to ${STAGE_LABELS[fields.stage as Stage]}`, meta: { from: before.stage, to: fields.stage }, userId: ctx.userId });
  }
  return json({ company: row });
});

export const DELETE = route<IdContext>(async (_request, context) => {
  const ctx = await requireMember();
  const id = await getId(context);
  const rows = await sql()`delete from companies where id = ${id} and workspace_id = ${ctx.workspaceId} returning id`;
  if (!rows.length) throw new ApiError(404, 'Company not found.');
  return json({ ok: true, id });
});
