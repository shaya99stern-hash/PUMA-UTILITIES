import { requireMember } from '@/lib/server/auth';
import { route, searchParams } from '@/lib/server/http';
import { sql } from '@/lib/server/db';
import { companyConditions } from '@/lib/crm/companies';
import { csvResponse, iso, today } from '@/lib/crm/export';

export const runtime = 'nodejs';

export const GET = route(async (request) => {
  const ctx = await requireMember();
  const p = searchParams(request);
  const db = sql();
  const where = companyConditions(db, ctx, {
    q: p.get('q'), stage: p.get('stage'), state: p.get('state'), type: p.get('type'), tag: p.get('tag'),
    minScore: p.get('minScore') ? Number(p.get('minScore')) : null, hasEmail: p.get('hasEmail') === '1',
  });
  const rows = await db`
    select c.*, (select ct.full_name from contacts ct where ct.company_id = c.id order by ct.is_decision_maker desc, ct.created_at limit 1) as contact_name,
      (select ct.title from contacts ct where ct.company_id = c.id order by ct.is_decision_maker desc, ct.created_at limit 1) as contact_title,
      (select ct.email from contacts ct where ct.company_id = c.id and ct.email is not null order by ct.is_decision_maker desc, ct.created_at limit 1) as contact_email,
      (select count(*) from contacts ct where ct.company_id = c.id) as contact_count,
      (select count(*) from properties pr where pr.company_id = c.id) as property_count
    from companies c where ${where} order by lower(c.name) limit 50000`;
  const headers = ['Company', 'Website', 'Phone', 'Email', 'Address', 'City', 'State', 'Zip', 'Type', 'Stage', 'Score', 'Buildings', 'Units', 'Est annual water spend', 'Tags', 'Primary contact', 'Contact title', 'Contact email', 'Contacts', 'Properties', 'Last activity', 'Next follow-up', 'Created'];
  return csvResponse(`puma-companies-${today()}.csv`, headers, rows.map((r) => [
    r.name, r.website ?? r.domain, r.phone, r.email, r.address, r.city, r.state, r.zip, r.company_type, r.stage, r.score, r.portfolio_buildings, r.portfolio_units,
    r.est_annual_water_spend, r.tags, r.contact_name, r.contact_title, r.contact_email, r.contact_count, r.property_count, iso(r.last_activity_at), iso(r.next_follow_up_at), iso(r.created_at),
  ]));
});
