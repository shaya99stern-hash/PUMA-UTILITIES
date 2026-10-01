import { requireMember } from '@/lib/server/auth';
import { route, searchParams } from '@/lib/server/http';
import { sql } from '@/lib/server/db';
import { csvResponse, iso, today } from '@/lib/crm/export';
import { escapeLike } from '@/lib/crm/server';

export const runtime = 'nodejs';

export const GET = route(async (request) => {
  const ctx = await requireMember();
  const p = searchParams(request);
  const db = sql();
  const parts = [db`p.workspace_id = ${ctx.workspaceId}`];
  const q = p.get('q')?.trim();
  if (q) parts.push(db`(p.name ilike ${`%${escapeLike(q)}%`} or p.address ilike ${`%${escapeLike(q)}%`} or p.city ilike ${`%${escapeLike(q)}%`})`);
  if (p.get('state')) parts.push(db`upper(p.state) = ${p.get('state')!.toUpperCase()}`);
  if (p.get('companyId')) parts.push(db`p.company_id = ${p.get('companyId')}`);
  const where = parts.reduce((acc, part, i) => (i ? db`${acc} and ${part}` : part));
  const rows = await db`
    select p.*, co.name as company_name from properties p left join companies co on co.id = p.company_id
    where ${where} order by lower(co.name) nulls last, lower(p.address) limit 50000`;
  const headers = ['Property', 'Address', 'City', 'State', 'Zip', 'County', 'Company', 'Units', 'Buildings', 'Year built', 'Stories', 'Class', 'Gross sqft', 'Owner on record', 'Manager', 'Utility', 'Meter status', 'Est annual water gallons', 'Est annual water cost', 'Source', 'Created'];
  return csvResponse(`puma-properties-${today()}.csv`, headers, rows.map((r) => [
    r.name, r.address, r.city, r.state, r.zip, r.county, r.company_name, r.units, r.buildings, r.year_built, r.stories, r.building_class, r.gross_sqft,
    r.owner_name_on_record, r.manager_name, r.utility_name, r.meter_status, r.est_annual_water_gallons, r.est_annual_water_cost, r.source, iso(r.created_at),
  ]));
});
