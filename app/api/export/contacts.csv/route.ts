import { requireMember } from '@/lib/server/auth';
import { route, searchParams } from '@/lib/server/http';
import { sql } from '@/lib/server/db';
import { contactConditions } from '@/lib/crm/contacts';
import { csvResponse, iso, today } from '@/lib/crm/export';

export const runtime = 'nodejs';

export const GET = route(async (request) => {
  const ctx = await requireMember();
  const db = sql();
  const where = contactConditions(db, ctx.workspaceId, searchParams(request));
  const rows = await db`
    select ct.*, co.name as company_name, co.stage as company_stage
    from contacts ct left join companies co on co.id = ct.company_id
    where ${where} order by lower(co.name) nulls last, lower(ct.full_name) limit 50000`;
  const headers = ['First name', 'Last name', 'Full name', 'Title', 'Role', 'Decision maker', 'Email', 'Email status', 'Phone', 'Mobile', 'LinkedIn', 'Company', 'Company stage', 'Tags', 'Unsubscribed', 'Last contacted', 'Created'];
  return csvResponse(`puma-contacts-${today()}.csv`, headers, rows.map((r) => [
    r.first_name, r.last_name, r.full_name, r.title, r.role_category, r.is_decision_maker ? 'yes' : 'no', r.email, r.email_status, r.phone, r.mobile, r.linkedin_url,
    r.company_name, r.company_stage, r.tags, iso(r.unsubscribed_at), iso(r.last_contacted_at), iso(r.created_at),
  ]));
});
