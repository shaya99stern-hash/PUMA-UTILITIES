import 'server-only';
import { companyNameKey, normalizeDomain, normalizeEmail, normalizePhone } from '@/lib/text';
import { ApiError } from '@/lib/server/http';
import type { MemberContext } from '@/lib/server/auth';
import { escapeLike, pgError, sql, type Db } from './server';
import type { CompanyListRow, CompanyRow, Stage } from './types';
import { STAGES } from './types';
import type { Sql } from '@/lib/server/db';

export type CompanyFilters = {
  q?: string | null;
  stage?: string | null;
  state?: string | null;
  type?: string | null;
  tag?: string | null;
  minScore?: number | null;
  hasEmail?: boolean | null;
  owner?: string | null;
};

type Ctx = Pick<MemberContext, 'workspaceId' | 'userId'>;

function and(db: Sql, parts: ReturnType<Sql>[]) {
  return parts.reduce((acc, part, i) => (i ? db`${acc} and ${part}` : part));
}

/** WHERE parts for company filters (stage is added separately so stage counts can ignore it). */
export function companyConditions(db: Sql, ctx: Ctx, f: CompanyFilters, withStage = true) {
  const parts: ReturnType<Sql>[] = [db`c.workspace_id = ${ctx.workspaceId}`];
  const q = f.q?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    parts.push(db`(c.name ilike ${like} or c.domain::text ilike ${like} or c.city ilike ${like} or exists (select 1 from contacts ct where ct.company_id = c.id and (ct.full_name ilike ${like} or ct.email::text ilike ${like})))`);
  }
  if (withStage && f.stage && (STAGES as readonly string[]).includes(f.stage)) parts.push(db`c.stage = ${f.stage}`);
  if (f.state) parts.push(db`upper(c.state) = ${f.state.toUpperCase()}`);
  if (f.type) parts.push(db`c.company_type = ${f.type}`);
  if (f.tag) parts.push(db`${f.tag} = any(c.tags)`);
  if (f.minScore !== null && f.minScore !== undefined && f.minScore > 0) parts.push(db`c.score >= ${f.minScore}`);
  if (f.hasEmail) parts.push(db`(c.email is not null or exists (select 1 from contacts ce where ce.company_id = c.id and ce.email is not null))`);
  if (f.owner) {
    const owner = f.owner === 'me' ? ctx.userId : f.owner;
    if (f.owner === 'unassigned' || (f.owner === 'me' && !owner)) parts.push(db`c.owner_user_id is null`);
    else if (/^[0-9a-f-]{36}$/i.test(owner ?? '')) parts.push(db`c.owner_user_id = ${owner}`);
  }
  return and(db, parts);
}

export const SORTS = ['name', 'score', 'stage', 'last_activity', 'follow_up', 'created', 'spend', 'units'] as const;

function orderBy(db: Sql, sort: string, dir: string) {
  const asc = dir === 'asc';
  switch (sort) {
    case 'name': return asc || !dir ? db`lower(c.name) asc` : db`lower(c.name) desc`;
    case 'score': return asc ? db`c.score asc nulls last, lower(c.name)` : db`c.score desc nulls last, lower(c.name)`;
    case 'stage': return asc || !dir ? db`array_position(array['new','qualified','contacted','meeting','proposal','installation','client','lost'], c.stage), lower(c.name)` : db`array_position(array['new','qualified','contacted','meeting','proposal','installation','client','lost'], c.stage) desc, lower(c.name)`;
    case 'follow_up': return dir === 'desc' ? db`c.next_follow_up_at desc nulls last` : db`c.next_follow_up_at asc nulls last`;
    case 'created': return asc ? db`c.created_at asc` : db`c.created_at desc`;
    case 'spend': return asc ? db`c.est_annual_water_spend asc nulls last` : db`c.est_annual_water_spend desc nulls last`;
    case 'units': return asc ? db`c.portfolio_units asc nulls last` : db`c.portfolio_units desc nulls last`;
    case 'last_activity':
    default: return asc ? db`c.last_activity_at asc nulls last` : db`c.last_activity_at desc nulls last, c.created_at desc`;
  }
}

const listCols = (db: Sql) => db`
  c.id, c.workspace_id, c.name, c.name_key, c.legal_name, c.domain, c.website, c.phone, c.email, c.address, c.city, c.state, c.zip,
  c.company_type, c.stage, c.owner_user_id, c.score, c.score_confidence, c.portfolio_buildings, c.portfolio_units, c.portfolio_basis,
  c.est_annual_water_spend, c.tags, c.description, c.linkedin_url, c.source, c.research_status, c.researched_at,
  c.next_follow_up_at, c.last_activity_at, c.last_contacted_at, c.created_at, c.updated_at`;

export async function listCompanies(ctx: Ctx, f: CompanyFilters, opts: { sort?: string; dir?: string; limit: number; offset: number }) {
  const db = sql();
  const where = companyConditions(db, ctx, f);
  const whereNoStage = companyConditions(db, ctx, f, false);
  const [rows, totals, stageCounts] = await Promise.all([
    db<CompanyListRow[]>`
      select ${listCols(db)},
        (select count(*) from contacts ct where ct.company_id = c.id) as contact_count,
        (select count(*) from properties p where p.company_id = c.id) as property_count,
        (c.email is not null or exists (select 1 from contacts ce where ce.company_id = c.id and ce.email is not null)) as has_email,
        (select ct.full_name from contacts ct where ct.company_id = c.id order by ct.is_decision_maker desc, ct.created_at limit 1) as top_contact_name
      from companies c where ${where}
      order by ${orderBy(db, opts.sort ?? 'last_activity', opts.dir ?? '')}
      limit ${opts.limit} offset ${opts.offset}`,
    db<{ total: number }[]>`select count(*) as total from companies c where ${where}`,
    db<{ stage: Stage; n: number }[]>`select c.stage, count(*) as n from companies c where ${whereNoStage} group by c.stage`,
  ]);
  const counts: Record<string, number> = { all: 0 };
  for (const s of STAGES) counts[s] = 0;
  for (const r of stageCounts) { counts[r.stage] = r.n; counts.all += r.n; }
  return { rows, total: totals[0]?.total ?? 0, counts };
}

export type CompanyInput = {
  name?: string;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  [key: string]: unknown;
};

/** Normalizes user-entered company fields (domain, phone, email, state, name_key). */
export function prepareCompanyFields(input: CompanyInput): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  if (input.name !== undefined) {
    out.name = String(input.name).trim();
    out.name_key = companyNameKey(out.name as string);
  }
  if (input.website !== undefined) {
    out.domain = normalizeDomain(input.website);
    if (input.website && !/^https?:\/\//i.test(input.website)) out.website = `https://${input.website.replace(/^\/+/, '')}`;
  }
  if (input.phone !== undefined) out.phone = input.phone ? normalizePhone(input.phone) : null;
  if (input.email !== undefined) {
    out.email = input.email ? normalizeEmail(input.email) : null;
    if (input.email && !out.email) throw new ApiError(400, 'That email address does not look valid.');
    if (out.email && input.website === undefined && out.domain === undefined) { /* keep domain untouched */ }
  }
  if (input.state !== undefined && input.state) out.state = String(input.state).trim().toUpperCase().slice(0, 40);
  return out;
}

/** Converts unique-violation errors on companies into a 409 that names the existing record. */
export async function throwCompanyConflict(error: unknown, ctx: Ctx, fields: Record<string, unknown>, selfId?: string): Promise<never> {
  const { code, constraint } = pgError(error);
  if (code === '23505') {
    const db = sql();
    let existing: { id: string; name: string }[] = [];
    if (constraint?.includes('domain') && fields.domain) {
      existing = await db<{ id: string; name: string }[]>`select id, name from companies where workspace_id = ${ctx.workspaceId} and domain = ${fields.domain as string} limit 1`;
    } else if (fields.name_key) {
      existing = await db<{ id: string; name: string }[]>`select id, name from companies where workspace_id = ${ctx.workspaceId} and name_key = ${fields.name_key as string} limit 1`;
    }
    const hit = existing.find((e) => e.id !== selfId) ?? existing[0];
    const by = constraint?.includes('domain') ? 'website' : 'name';
    throw new ApiError(409, hit ? `${hit.name} already exists with the same ${by}.` : `A company with the same ${by} already exists.`, { existingId: hit?.id ?? null, existingName: hit?.name ?? null });
  }
  throw error;
}

export async function getCompanyRow(db: Db, workspaceId: string, id: string): Promise<CompanyRow> {
  const rows = await (db as Sql)<CompanyRow[]>`select * from companies where id = ${id} and workspace_id = ${workspaceId}`;
  if (!rows[0]) throw new ApiError(404, 'Company not found.');
  return rows[0];
}
