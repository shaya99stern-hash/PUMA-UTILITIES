import { requireMember } from '@/lib/server/auth';
import { intParam, json, readJson, route, searchParams } from '@/lib/server/http';
import { sql } from '@/lib/server/db';
import { listCompanies, prepareCompanyFields, throwCompanyConflict } from '@/lib/crm/companies';
import { logActivity } from '@/lib/crm/activity';
import { companyCreateSchema } from '@/lib/crm/schemas';
import type { CompanyRow } from '@/lib/crm/types';

export const runtime = 'nodejs';

export const GET = route(async (request) => {
  const ctx = await requireMember();
  const p = searchParams(request);
  const minScore = p.get('minScore') ? Number(p.get('minScore')) : null;
  const result = await listCompanies(
    ctx,
    {
      q: p.get('q'),
      stage: p.get('stage'),
      state: p.get('state'),
      type: p.get('type'),
      tag: p.get('tag'),
      minScore: Number.isFinite(minScore) ? minScore : null,
      hasEmail: p.get('hasEmail') === '1' || p.get('hasEmail') === 'true',
      owner: p.get('owner'),
    },
    { sort: p.get('sort') ?? undefined, dir: p.get('dir') ?? undefined, limit: intParam(p.get('limit'), 50, 1, 200), offset: intParam(p.get('offset'), 0, 0, 1_000_000) },
  );
  if (p.get('facets') === '1') {
    const db = sql();
    const [states, tags] = await Promise.all([
      db<{ value: string; n: number }[]>`select upper(state) as value, count(*) as n from companies where workspace_id = ${ctx.workspaceId} and state is not null group by 1 order by n desc limit 60`,
      db<{ value: string; n: number }[]>`select t as value, count(*) as n from companies, unnest(tags) as t where workspace_id = ${ctx.workspaceId} group by 1 order by n desc limit 40`,
    ]);
    return json({ ...result, facets: { states, tags } });
  }
  return json(result);
});

export const POST = route(async (request) => {
  const ctx = await requireMember();
  const body = await readJson(request, companyCreateSchema);
  const { tags, ...rest } = body;
  const fields = prepareCompanyFields(rest);
  const db = sql();
  let row: CompanyRow;
  try {
    const cols = { ...fields, workspace_id: ctx.workspaceId, created_by: ctx.userId, source: 'manual' } as Record<string, unknown>;
    const keys = Object.keys(cols).filter((k) => cols[k] !== undefined);
    const inserted = await db<CompanyRow[]>`insert into companies ${db(cols, ...keys)} returning *`;
    row = inserted[0];
    if (tags?.length) {
      const updated = await db<CompanyRow[]>`update companies set tags = ${db.array(tags, 1009)} where id = ${row.id} returning *`;
      row = updated[0];
    }
  } catch (error) {
    return await throwCompanyConflict(error, ctx, fields);
  }
  await logActivity({ workspaceId: ctx.workspaceId, companyId: row.id, type: 'system', subject: 'Company created', userId: ctx.userId });
  return json({ company: row }, 201);
});
