import { requireMember } from '@/lib/server/auth';
import { intParam, json, readJson, route, searchParams } from '@/lib/server/http';
import { sql } from '@/lib/server/db';
import { logActivity } from '@/lib/crm/activity';
import { assertCompany } from '@/lib/crm/contacts';
import { propertyCreateSchema } from '@/lib/crm/schemas';
import { escapeLike } from '@/lib/crm/server';
import type { PropertyListRow, PropertyRow } from '@/lib/crm/types';

export const runtime = 'nodejs';

export const GET = route(async (request) => {
  const ctx = await requireMember();
  const p = searchParams(request);
  const db = sql();
  const parts = [db`p.workspace_id = ${ctx.workspaceId}`];
  const q = p.get('q')?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    parts.push(db`(p.name ilike ${like} or p.address ilike ${like} or p.city ilike ${like} or p.zip ilike ${like} or co.name ilike ${like} or p.utility_name ilike ${like})`);
  }
  if (p.get('companyId')) parts.push(db`p.company_id = ${p.get('companyId')}`);
  if (p.get('state')) parts.push(db`upper(p.state) = ${p.get('state')!.toUpperCase()}`);
  if (p.get('meterStatus')) parts.push(db`p.meter_status = ${p.get('meterStatus')}`);
  if (p.get('minUnits')) parts.push(db`p.units >= ${Number(p.get('minUnits')) || 0}`);
  if (p.get('unassigned') === '1') parts.push(db`p.company_id is null`);
  const where = parts.reduce((acc, part, i) => (i ? db`${acc} and ${part}` : part));
  const sort = p.get('sort');
  const order = sort === 'name' ? db`lower(coalesce(p.name, p.address))`
    : sort === 'cost' ? db`p.est_annual_water_cost desc nulls last`
    : sort === 'created' ? db`p.created_at desc`
    : db`p.units desc nulls last, lower(p.address)`;
  const limit = intParam(p.get('limit'), 50, 1, 500);
  const offset = intParam(p.get('offset'), 0, 0, 1_000_000);
  const [rows, total] = await Promise.all([
    db<PropertyListRow[]>`
      select p.id, p.workspace_id, p.company_id, p.name, p.address, p.city, p.state, p.zip, p.county, p.units, p.buildings, p.year_built,
        p.stories, p.building_class, p.gross_sqft, p.manager_name, p.owner_name_on_record, p.utility_name, p.meter_status,
        p.est_annual_water_gallons, p.est_annual_water_cost, p.source, p.created_at, p.updated_at,
        co.name as company_name, co.stage as company_stage
      from properties p left join companies co on co.id = p.company_id
      where ${where} order by ${order} limit ${limit} offset ${offset}`,
    db<{ n: number }[]>`select count(*) as n from properties p left join companies co on co.id = p.company_id where ${where}`,
  ]);
  return json({ rows, total: total[0]?.n ?? 0 });
});

export const POST = route(async (request) => {
  const ctx = await requireMember();
  const body = await readJson(request, propertyCreateSchema);
  await assertCompany(ctx.workspaceId, body.company_id as string | null | undefined);
  const db = sql();
  const cols: Record<string, unknown> = { ...body, workspace_id: ctx.workspaceId, source: 'manual' };
  if (cols.state) cols.state = String(cols.state).toUpperCase().slice(0, 40);
  const keys = Object.keys(cols).filter((k) => cols[k] !== undefined);
  const rows = await db<PropertyRow[]>`insert into properties ${db(cols, ...keys)} returning *`;
  const row = rows[0];
  if (row.company_id) {
    await logActivity({ workspaceId: ctx.workspaceId, companyId: row.company_id, propertyId: row.id, type: 'system', subject: `Added property ${row.name ?? row.address}`, userId: ctx.userId });
  }
  return json({ property: row }, 201);
});
