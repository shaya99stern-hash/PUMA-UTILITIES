import { requireMember } from '@/lib/server/auth';
import { intParam, json, readJson, route, searchParams } from '@/lib/server/http';
import { sql } from '@/lib/server/db';
import { taskCreateSchema } from '@/lib/crm/schemas';
import { safeTimeZone, syncFollowUp } from '@/lib/crm/server';
import type { TaskListRow, TaskRow } from '@/lib/crm/types';

export const runtime = 'nodejs';

export const GET = route(async (request) => {
  const ctx = await requireMember();
  const p = searchParams(request);
  const db = sql();
  const tz = safeTimeZone(p.get('tz'));
  const ws = ctx.workspaceId;
  const today = db`(now() at time zone ${tz})::date`;
  const dueDay = db`(t.due_at at time zone ${tz})::date`;

  const parts = [db`t.workspace_id = ${ws}`];
  const status = p.get('status');
  const due = p.get('due');
  if (status === 'open' || status === 'done') parts.push(db`t.status = ${status}`);
  if (due === 'today') parts.push(db`t.status = 'open' and t.due_at is not null and ${dueDay} = ${today}`);
  else if (due === 'overdue') parts.push(db`t.status = 'open' and t.due_at is not null and ${dueDay} < ${today}`);
  else if (due === 'upcoming') parts.push(db`t.status = 'open' and t.due_at is not null and ${dueDay} > ${today}`);
  else if (due === 'none') parts.push(db`t.status = 'open' and t.due_at is null`);
  if (p.get('companyId')) parts.push(db`t.company_id = ${p.get('companyId')}`);
  if (p.get('contactId')) parts.push(db`t.contact_id = ${p.get('contactId')}`);
  if (p.get('propertyId')) parts.push(db`t.property_id = ${p.get('propertyId')}`);
  if (p.get('assignee') === 'me' && ctx.userId) parts.push(db`t.assignee_id = ${ctx.userId}`);
  const where = parts.reduce((acc, part, i) => (i ? db`${acc} and ${part}` : part));
  const limit = intParam(p.get('limit'), 100, 1, 500);
  const order = status === 'done' || due === 'done' ? db`t.completed_at desc nulls last` : db`t.due_at asc nulls last, t.created_at desc`;

  const [rows, counts] = await Promise.all([
    db<TaskListRow[]>`
      select t.*, co.name as company_name, ct.full_name as contact_name
      from tasks t left join companies co on co.id = t.company_id left join contacts ct on ct.id = t.contact_id
      where ${where} order by ${order} limit ${limit}`,
    db<{ today: number; overdue: number; upcoming: number; no_date: number; done: number }[]>`
      select
        count(*) filter (where t.status = 'open' and t.due_at is not null and ${dueDay} = ${today}) as today,
        count(*) filter (where t.status = 'open' and t.due_at is not null and ${dueDay} < ${today}) as overdue,
        count(*) filter (where t.status = 'open' and t.due_at is not null and ${dueDay} > ${today}) as upcoming,
        count(*) filter (where t.status = 'open' and t.due_at is null) as no_date,
        count(*) filter (where t.status = 'done' and t.completed_at > now() - interval '30 days') as done
      from tasks t where t.workspace_id = ${ws}`,
  ]);
  return json({ rows, counts: counts[0] });
});

export const POST = route(async (request) => {
  const ctx = await requireMember();
  const body = await readJson(request, taskCreateSchema);
  const db = sql();
  const cols: Record<string, unknown> = { ...body, workspace_id: ctx.workspaceId, created_by: ctx.userId };
  if (cols.assignee_id === undefined && ctx.userId) cols.assignee_id = ctx.userId;
  if (typeof cols.due_at === 'string') cols.due_at = new Date(cols.due_at as string);
  const keys = Object.keys(cols).filter((k) => cols[k] !== undefined);
  const rows = await db<TaskRow[]>`insert into tasks ${db(cols, ...keys)} returning *`;
  await syncFollowUp(db, ctx.workspaceId, rows[0].company_id);
  return json({ task: rows[0] }, 201);
});
