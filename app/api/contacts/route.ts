import { requireMember } from '@/lib/server/auth';
import { intParam, json, readJson, route, searchParams } from '@/lib/server/http';
import { sql } from '@/lib/server/db';
import { logActivity } from '@/lib/crm/activity';
import { assertCompany, contactConditions, prepareContactFields, throwContactConflict } from '@/lib/crm/contacts';
import { contactCreateSchema } from '@/lib/crm/schemas';
import type { ContactListRow, ContactRow } from '@/lib/crm/types';

export const runtime = 'nodejs';

export const GET = route(async (request) => {
  const ctx = await requireMember();
  const p = searchParams(request);
  const db = sql();
  const where = contactConditions(db, ctx.workspaceId, p);
  const sort = p.get('sort');
  const order = sort === 'name' ? db`lower(ct.full_name)`
    : sort === 'company' ? db`lower(co.name) nulls last, lower(ct.full_name)`
    : sort === 'created' ? db`ct.created_at desc`
    : db`ct.is_decision_maker desc, ct.last_contacted_at desc nulls last, lower(ct.full_name)`;
  const limit = intParam(p.get('limit'), 50, 1, 500);
  const offset = intParam(p.get('offset'), 0, 0, 1_000_000);
  const [rows, total] = await Promise.all([
    db<ContactListRow[]>`
      select ct.*, co.name as company_name, co.stage as company_stage
      from contacts ct left join companies co on co.id = ct.company_id
      where ${where} order by ${order} limit ${limit} offset ${offset}`,
    db<{ n: number }[]>`select count(*) as n from contacts ct left join companies co on co.id = ct.company_id where ${where}`,
  ]);
  return json({ rows, total: total[0]?.n ?? 0 });
});

export const POST = route(async (request) => {
  const ctx = await requireMember();
  const body = await readJson(request, contactCreateSchema);
  const { tags, ...rest } = body;
  await assertCompany(ctx.workspaceId, rest.company_id as string | null | undefined);
  const fields = prepareContactFields(rest);
  if (!fields.full_name) {
    fields.full_name = [rest.first_name, rest.last_name].filter(Boolean).join(' ') || String(fields.email ?? '').split('@')[0];
  }
  const db = sql();
  let row: ContactRow;
  try {
    const cols: Record<string, unknown> = { ...fields, workspace_id: ctx.workspaceId, created_by: ctx.userId, source: 'manual' };
    const keys = Object.keys(cols).filter((k) => cols[k] !== undefined);
    const inserted = await db<ContactRow[]>`insert into contacts ${db(cols, ...keys)} returning *`;
    row = inserted[0];
    if (tags?.length) row = (await db<ContactRow[]>`update contacts set tags = ${db.array(tags, 1009)} where id = ${row.id} returning *`)[0];
  } catch (error) {
    return await throwContactConflict(error, ctx.workspaceId, fields.email);
  }
  if (row.company_id) {
    await logActivity({ workspaceId: ctx.workspaceId, companyId: row.company_id, contactId: row.id, type: 'system', subject: `Added contact ${row.full_name}`, userId: ctx.userId });
  }
  return json({ contact: row }, 201);
});
