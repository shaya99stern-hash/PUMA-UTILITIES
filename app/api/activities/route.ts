import { requireMember } from '@/lib/server/auth';
import { intParam, json, readJson, route, searchParams } from '@/lib/server/http';
import { sql } from '@/lib/server/db';
import { logActivity } from '@/lib/crm/activity';
import { activityCreateSchema } from '@/lib/crm/schemas';
import { ACTIVITY_TYPES, type ActivityListRow } from '@/lib/crm/types';
import { ApiError } from '@/lib/server/http';

export const runtime = 'nodejs';

export const GET = route(async (request) => {
  const ctx = await requireMember();
  const p = searchParams(request);
  const db = sql();
  const parts = [db`a.workspace_id = ${ctx.workspaceId}`];
  if (p.get('companyId')) parts.push(db`a.company_id = ${p.get('companyId')}`);
  if (p.get('contactId')) parts.push(db`a.contact_id = ${p.get('contactId')}`);
  if (p.get('propertyId')) parts.push(db`a.property_id = ${p.get('propertyId')}`);
  const type = p.get('type');
  if (type && (ACTIVITY_TYPES as readonly string[]).includes(type)) parts.push(db`a.type = ${type}`);
  const before = p.get('before');
  if (before && !Number.isNaN(Date.parse(before))) parts.push(db`a.occurred_at < ${new Date(before)}`);
  const where = parts.reduce((acc, part, i) => (i ? db`${acc} and ${part}` : part));
  const limit = intParam(p.get('limit'), 50, 1, 200);
  const rows = await db<ActivityListRow[]>`
    select a.*, co.name as company_name, ct.full_name as contact_name, pr.full_name as author_name
    from activities a
    left join companies co on co.id = a.company_id
    left join contacts ct on ct.id = a.contact_id
    left join profiles pr on pr.user_id = a.created_by
    where ${where} order by a.occurred_at desc limit ${limit}`;
  return json({ rows });
});

export const POST = route(async (request) => {
  const ctx = await requireMember();
  const body = await readJson(request, activityCreateSchema);
  const db = sql();
  // Every linked record must belong to this workspace.
  const exists = async (table: 'companies' | 'contacts' | 'properties', id: string | null | undefined) => {
    if (!id) return true;
    const r = await db`select 1 from ${db(table)} where id = ${id} and workspace_id = ${ctx.workspaceId}`;
    return r.length > 0;
  };
  const checks = await Promise.all([exists('companies', body.company_id as string | null | undefined), exists('contacts', body.contact_id as string | null | undefined), exists('properties', body.property_id as string | null | undefined)]);
  if (checks.some((ok) => !ok)) throw new ApiError(400, 'Linked record not found.');
  const activity = await logActivity({
    workspaceId: ctx.workspaceId,
    companyId: body.company_id as string | null | undefined,
    contactId: body.contact_id as string | null | undefined,
    propertyId: body.property_id as string | null | undefined,
    type: body.type ?? 'note',
    subject: body.subject ?? null,
    body: body.body ?? null,
    meta: body.meta,
    userId: ctx.userId,
    occurredAt: body.occurred_at as string | null | undefined,
  });
  return json({ activity }, 201);
});
