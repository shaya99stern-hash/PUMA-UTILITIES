import 'server-only';
import { z } from 'zod';
import { sql } from '@/lib/server/db';
import { normalizeEmail, splitName, titleCase } from '@/lib/text';

export const audienceFilterSchema = z.object({
  q: z.string().max(200).optional(),
  stage: z.string().max(40).optional(),
  state: z.string().max(40).optional(),
  companyType: z.string().max(40).optional(),
  decisionMakersOnly: z.boolean().optional(),
});
export type AudienceFilter = z.infer<typeof audienceFilterSchema>;

export type AudienceRow = {
  contact_id: string | null;
  company_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  title: string | null;
  is_decision_maker: boolean;
  company_name: string | null;
  city: string | null;
  state: string | null;
  stage: string | null;
  score: number | null;
  portfolio_units: number | null;
  unsubscribed_at: Date | null;
  bounced_at: Date | null;
  suppressed: string | null;
};

type Selection = { contactIds?: string[]; companyIds?: string[]; filter?: AudienceFilter; includeCompanyEmails?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuids = (list?: string[]) => (list ?? []).filter((id) => UUID.test(id));

function likePattern(q: string) {
  return `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
}

/**
 * Contacts (and, as a fallback, company-level addresses for companies with no contact emails)
 * that match a selection. Used for the wizard's audience step and for adding recipients.
 */
export async function searchAudience(workspaceId: string, selection: Selection, page: { limit: number; offset?: number }) {
  const db = sql();
  const f = selection.filter ?? {};
  const contactIds = uuids(selection.contactIds);
  const companyIds = uuids(selection.companyIds);
  const hasExplicit = !!(selection.contactIds || selection.companyIds);
  if (hasExplicit && !contactIds.length && !companyIds.length) return { rows: [] as AudienceRow[], total: 0 };
  const like = f.q?.trim() ? likePattern(f.q.trim()) : null;
  const includeCompanyEmails = selection.includeCompanyEmails !== false && !f.decisionMakersOnly;

  const contactWhere = db`
    c.workspace_id = ${workspaceId} and c.email is not null
    ${contactIds.length || companyIds.length ? db`and (${contactIds.length ? db`c.id = any(${contactIds}::uuid[])` : db`false`} or ${companyIds.length ? db`c.company_id = any(${companyIds}::uuid[])` : db`false`})` : db``}
    ${f.decisionMakersOnly ? db`and c.is_decision_maker` : db``}
    ${f.stage ? db`and co.stage = ${f.stage}` : db``}
    ${f.state ? db`and upper(co.state) = ${f.state.toUpperCase()}` : db``}
    ${f.companyType ? db`and co.company_type = ${f.companyType}` : db``}
    ${like ? db`and (co.name ilike ${like} or c.full_name ilike ${like} or c.email::text ilike ${like} or c.title ilike ${like})` : db``}`;

  const companyWhere = db`
    co.workspace_id = ${workspaceId} and co.email is not null
    and not exists (select 1 from contacts c2 where c2.company_id = co.id and c2.email is not null)
    ${contactIds.length ? db`and false` : db``}
    ${companyIds.length ? db`and co.id = any(${companyIds}::uuid[])` : hasExplicit ? db`and false` : db``}
    ${f.stage ? db`and co.stage = ${f.stage}` : db``}
    ${f.state ? db`and upper(co.state) = ${f.state.toUpperCase()}` : db``}
    ${f.companyType ? db`and co.company_type = ${f.companyType}` : db``}
    ${like ? db`and (co.name ilike ${like} or co.email::text ilike ${like})` : db``}`;

  const union = db`
    select c.id as contact_id, c.company_id, c.email::text as email, c.first_name, c.last_name, c.full_name, c.title, c.is_decision_maker,
           co.name as company_name, co.city, co.state, co.stage, co.score, co.portfolio_units, c.unsubscribed_at, c.bounced_at
    from contacts c left join companies co on co.id = c.company_id
    where ${contactWhere}
    ${includeCompanyEmails
      ? db`union all
    select null::uuid, co.id, co.email::text, null, null, null, null, false,
           co.name, co.city, co.state, co.stage, co.score, co.portfolio_units, null::timestamptz, null::timestamptz
    from companies co where ${companyWhere}`
      : db``}`;

  const rows = await db<AudienceRow[]>`
    with aud as (${union})
    select a.*, s.reason as suppressed
    from aud a left join suppressions s on s.workspace_id = ${workspaceId} and s.email = a.email
    order by a.score desc nulls last, a.company_name nulls last, a.full_name nulls last
    limit ${page.limit} offset ${page.offset ?? 0}`;
  const total = await db<{ n: number }[]>`with aud as (${union}) select count(*)::int as n from aud`;
  return { rows, total: total[0]?.n ?? 0 };
}

export type RecipientSeed = {
  contact_id: string | null;
  company_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  merge: Record<string, unknown>;
};

export function seedFromRow(row: AudienceRow): RecipientSeed {
  const name = row.full_name ?? '';
  return {
    contact_id: row.contact_id,
    company_id: row.company_id,
    email: row.email.toLowerCase(),
    first_name: row.first_name ?? (name ? splitName(name).first : null),
    last_name: row.last_name ?? (name ? splitName(name).last : null),
    company_name: row.company_name,
    merge: { full_name: row.full_name, title: row.title, city: row.city, state: row.state, portfolio_units: row.portfolio_units },
  };
}

/** Minimal CSV parser (quotes, commas, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === '\t' || ch === ';') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

/** Turns pasted emails ("a@b.com, Jane <j@x.com>") and/or CSV text into recipient seeds. */
export function seedsFromText(input: { emails?: string[]; csv?: string }): { seeds: RecipientSeed[]; invalid: string[] } {
  const seeds: RecipientSeed[] = [];
  const invalid: string[] = [];
  const add = (raw: string, first?: string | null, last?: string | null, company?: string | null) => {
    const m = raw.match(/^(.*?)<([^>]+)>$/);
    const email = normalizeEmail(m ? m[2] : raw);
    if (!email) {
      if (raw.trim()) invalid.push(raw.trim());
      return;
    }
    let f = first ?? null;
    let l = last ?? null;
    const display = m?.[1]?.replace(/["']/g, '').trim();
    if (!f && display) ({ first: f, last: l } = splitName(display));
    seeds.push({
      contact_id: null,
      company_id: null,
      email,
      first_name: f ? titleCase(f) : null,
      last_name: l ? titleCase(l) : null,
      company_name: company ?? null,
      merge: { full_name: [f, l].filter(Boolean).join(' ') || null },
    });
  };
  for (const entry of input.emails ?? []) for (const part of entry.split(/[\n,;]+/)) add(part.trim());
  if (input.csv?.trim()) {
    const rows = parseCsv(input.csv);
    if (rows.length) {
      const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
      const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
      const emailCol = col('email', 'email_address', 'e_mail');
      const hasHeader = emailCol >= 0;
      const first = col('first_name', 'first', 'firstname');
      const last = col('last_name', 'last', 'lastname');
      const name = col('name', 'full_name');
      const company = col('company', 'company_name', 'organization');
      for (const r of hasHeader ? rows.slice(1) : rows) {
        const email = hasHeader ? (r[emailCol] ?? '') : (r.find((c) => c.includes('@')) ?? '');
        let f = hasHeader && first >= 0 ? r[first] : null;
        let l = hasHeader && last >= 0 ? r[last] : null;
        if (!f && hasHeader && name >= 0 && r[name]) ({ first: f, last: l } = splitName(r[name]));
        add(email.trim(), f?.trim(), l?.trim(), hasHeader && company >= 0 ? r[company]?.trim() : null);
      }
    }
  }
  return { seeds, invalid };
}

export type AddResult = { added: number; duplicates: number; suppressed: number; unsubscribed: number; invalid: number; invalidExamples: string[] };

/** Inserts recipients (skipping suppressed / unsubscribed / bounced / already present). */
export async function insertRecipients(workspaceId: string, campaignId: string, seeds: RecipientSeed[], extras: { invalid?: string[] } = {}): Promise<AddResult> {
  const db = sql();
  const result: AddResult = { added: 0, duplicates: 0, suppressed: 0, unsubscribed: 0, invalid: extras.invalid?.length ?? 0, invalidExamples: (extras.invalid ?? []).slice(0, 5) };
  const unique = new Map<string, RecipientSeed>();
  for (const s of seeds) {
    const key = s.email.toLowerCase();
    if (unique.has(key)) result.duplicates += 1;
    else unique.set(key, s);
  }
  const all = [...unique.values()];
  for (let i = 0; i < all.length; i += 400) {
    const chunk = all.slice(i, i + 400);
    const emails = chunk.map((c) => c.email);
    const blocked = await db<{ email: string; reason: string }[]>`
      select email::text as email, reason from suppressions where workspace_id = ${workspaceId} and email = any(${emails}::extensions.citext[])`;
    const flagged = await db<{ email: string }[]>`
      select email::text as email from contacts where workspace_id = ${workspaceId} and email = any(${emails}::extensions.citext[]) and (unsubscribed_at is not null or bounced_at is not null)`;
    const blockedSet = new Set(blocked.map((b) => b.email.toLowerCase()));
    const flaggedSet = new Set(flagged.map((b) => b.email.toLowerCase()));
    const ok = chunk.filter((c) => {
      const e = c.email.toLowerCase();
      if (blockedSet.has(e)) {
        result.suppressed += 1;
        return false;
      }
      if (flaggedSet.has(e)) {
        result.unsubscribed += 1;
        return false;
      }
      return true;
    });
    if (!ok.length) continue;
    const inserted = await db<{ id: string }[]>`
      insert into campaign_recipients (workspace_id, campaign_id, contact_id, company_id, email, first_name, last_name, company_name, merge)
      select ${workspaceId}::uuid, ${campaignId}::uuid, u.contact_id, u.company_id, u.email, u.first_name, u.last_name, u.company_name, coalesce(u.merge, '{}'::jsonb)
      from jsonb_to_recordset(${db.json(ok as never)}::jsonb) as u(contact_id uuid, company_id uuid, email text, first_name text, last_name text, company_name text, merge jsonb)
      on conflict (campaign_id, email) do nothing
      returning id`;
    result.added += inserted.length;
    result.duplicates += ok.length - inserted.length;
  }
  return result;
}
