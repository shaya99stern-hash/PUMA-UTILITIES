import { requireMember } from '@/lib/server/auth';
import { intParam, json, readJson, route, searchParams } from '@/lib/server/http';
import { sql } from '@/lib/server/db';
import { assertCompany } from '@/lib/crm/contacts';
import { payableCreateSchema } from '@/lib/crm/schemas';
import { dateOnly, escapeLike } from '@/lib/crm/server';
import type { PayableListRow, PayableRow } from '@/lib/crm/types';

export const runtime = 'nodejs';

/** Effective status treats unpaid items past their due date as overdue. */
export const GET = route(async (request) => {
  const ctx = await requireMember();
  const p = searchParams(request);
  const db = sql();
  const eff = db`(case when pa.status in ('due', 'overdue') and pa.due_date is not null and pa.due_date < current_date then 'overdue' else pa.status end)`;
  const parts = [db`pa.workspace_id = ${ctx.workspaceId}`];
  const status = p.get('status');
  if (status && status !== 'all') parts.push(db`${eff} = ${status}`);
  if (p.get('companyId')) parts.push(db`pa.company_id = ${p.get('companyId')}`);
  const q = p.get('q')?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    parts.push(db`(pa.description ilike ${like} or co.name ilike ${like})`);
  }
  const where = parts.reduce((acc, part, i) => (i ? db`${acc} and ${part}` : part));
  const limit = intParam(p.get('limit'), 200, 1, 1000);
  const [rows, summary] = await Promise.all([
    db<PayableListRow[]>`
      select pa.*, pa.due_date::text as due_date, ${eff} as effective_status, co.name as company_name, coalesce(pr.name, pr.address) as property_name
      from payables pa left join companies co on co.id = pa.company_id left join properties pr on pr.id = pa.property_id
      where ${where}
      order by (case when ${eff} = 'overdue' then 0 when ${eff} = 'due' then 1 when ${eff} = 'draft' then 2 else 3 end), pa.due_date asc nulls last, pa.created_at desc
      limit ${limit}`,
    db<{ outstanding: number; paid: number; overdue_count: number; overdue_amount: number; due_count: number; draft: number }[]>`
      select
        coalesce(sum(pa.amount) filter (where pa.status in ('due', 'overdue')), 0) as outstanding,
        coalesce(sum(pa.amount) filter (where pa.status = 'paid'), 0) as paid,
        count(*) filter (where pa.status in ('due', 'overdue') and pa.due_date is not null and pa.due_date < current_date) as overdue_count,
        coalesce(sum(pa.amount) filter (where pa.status in ('due', 'overdue') and pa.due_date is not null and pa.due_date < current_date), 0) as overdue_amount,
        count(*) filter (where pa.status in ('due', 'overdue')) as due_count,
        coalesce(sum(pa.amount) filter (where pa.status = 'draft'), 0) as draft
      from payables pa where pa.workspace_id = ${ctx.workspaceId}`,
  ]);
  return json({ rows, summary: summary[0] });
});

export const POST = route(async (request) => {
  const ctx = await requireMember();
  const body = await readJson(request, payableCreateSchema);
  await assertCompany(ctx.workspaceId, body.company_id as string | null | undefined);
  const db = sql();
  const cols: Record<string, unknown> = { ...body, workspace_id: ctx.workspaceId };
  if (cols.status === 'paid') cols.paid_at = new Date();
  const keys = Object.keys(cols).filter((k) => cols[k] !== undefined);
  const rows = await db<PayableRow[]>`insert into payables ${db(cols, ...keys)} returning *`;
  return json({ payable: { ...rows[0], due_date: dateOnly(rows[0].due_date) } }, 201);
});
