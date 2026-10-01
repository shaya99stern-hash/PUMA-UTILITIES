import { requireMember } from '@/lib/server/auth';
import { json, route, searchParams } from '@/lib/server/http';
import { sql } from '@/lib/server/db';

export const runtime = 'nodejs';

/**
 * Client monitoring overview. Only companies at stage 'client' are included:
 * readings are client-authorized data and never shown for prospects.
 */
export const GET = route(async (request) => {
  const ctx = await requireMember();
  const p = searchParams(request);
  const db = sql();
  const ws = ctx.workspaceId;
  const statusFilter = p.get('status') === 'all' ? db`true` : db`a.status in ('open', 'acknowledged')`;

  const [alerts, meters, properties, summary] = await Promise.all([
    db`
      select a.*, coalesce(pr.name, pr.address) as property_name, pr.company_id, co.name as company_name, m.label as meter_label
      from alerts a
      join properties pr on pr.id = a.property_id
      join companies co on co.id = pr.company_id and co.stage = 'client'
      left join meters m on m.id = a.meter_id
      where a.workspace_id = ${ws} and ${statusFilter}
      order by (a.status = 'resolved'), (case a.severity when 'critical' then 0 when 'warning' then 1 else 2 end), a.detected_at desc
      limit 200`,
    db`
      select m.*, coalesce(pr.name, pr.address) as property_name, pr.address as property_address, pr.company_id, co.name as company_name,
        lr.id as last_reading_id, lr.period_end as last_period_end, lr.gallons as last_gallons, lr.cost as last_cost,
        (select coalesce(json_agg(g order by pe), '[]'::json) from (
           select r.gallons as g, r.period_end as pe from meter_readings r where r.meter_id = m.id order by r.period_end desc limit 8) s) as recent,
        (select count(*) from alerts a where a.meter_id = m.id and a.status = 'open') as open_alerts
      from meters m
      join properties pr on pr.id = m.property_id
      join companies co on co.id = pr.company_id and co.stage = 'client'
      left join lateral (select * from meter_readings r where r.meter_id = m.id order by r.period_end desc limit 1) lr on true
      where m.workspace_id = ${ws}
      order by co.name, pr.address, m.label`,
    db`
      select pr.id, coalesce(pr.name, pr.address) as name, pr.address, pr.company_id, co.name as company_name, pr.units,
        (select count(*) from meters m where m.property_id = pr.id) as meter_count
      from properties pr join companies co on co.id = pr.company_id and co.stage = 'client'
      where pr.workspace_id = ${ws} order by co.name, pr.address`,
    db`
      select
        count(*) filter (where a.status = 'open') as open_alerts,
        count(*) filter (where a.status = 'open' and a.severity = 'critical') as critical_alerts,
        (select count(*) from meters m join properties pr on pr.id = m.property_id join companies co on co.id = pr.company_id and co.stage = 'client' where m.workspace_id = ${ws} and m.status = 'active') as active_meters,
        (select count(*) from companies where workspace_id = ${ws} and stage = 'client') as client_companies
      from alerts a
      join properties pr on pr.id = a.property_id
      join companies co on co.id = pr.company_id and co.stage = 'client'
      where a.workspace_id = ${ws}`,
  ]);
  return json({ alerts, meters, properties, summary: summary[0] });
});
