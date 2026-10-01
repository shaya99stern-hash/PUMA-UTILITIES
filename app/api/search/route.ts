import { requireMember } from '@/lib/server/auth';
import { json, route, searchParams } from '@/lib/server/http';
import { sql } from '@/lib/server/db';
import { escapeLike } from '@/lib/crm/server';

export const runtime = 'nodejs';

/** Global search for the ⌘K palette: top 5 companies, contacts and properties. */
export const GET = route(async (request) => {
  const ctx = await requireMember();
  const q = (searchParams(request).get('q') ?? '').trim();
  if (q.length < 1) return json({ companies: [], contacts: [], properties: [] });
  const db = sql();
  const like = `%${escapeLike(q)}%`;
  const prefix = `${escapeLike(q)}%`;
  const ws = ctx.workspaceId;
  const [companies, contacts, properties] = await Promise.all([
    db`select c.id, c.name, c.stage, c.domain, c.city, c.state, c.score from companies c
       where c.workspace_id = ${ws} and (c.name ilike ${like} or c.domain::text ilike ${like})
       order by (c.name ilike ${prefix}) desc, c.score desc nulls last, c.name limit 5`,
    db`select ct.id, ct.full_name, ct.title, ct.email, ct.company_id, co.name as company_name from contacts ct
       left join companies co on co.id = ct.company_id
       where ct.workspace_id = ${ws} and (ct.full_name ilike ${like} or ct.email::text ilike ${like})
       order by (ct.full_name ilike ${prefix}) desc, ct.full_name limit 5`,
    db`select p.id, p.name, p.address, p.city, p.state, p.units, p.company_id, co.name as company_name from properties p
       left join companies co on co.id = p.company_id
       where p.workspace_id = ${ws} and (p.name ilike ${like} or p.address ilike ${like})
       order by (coalesce(p.name, p.address) ilike ${prefix}) desc, p.address limit 5`,
  ]);
  return json({ companies, contacts, properties });
});
