import { after } from 'next/server';
import { z } from 'zod';
import { createDiscoverJob, pumpJob } from '@/lib/engine/jobs';
import { requireMember } from '@/lib/server/auth';
import { sql } from '@/lib/server/db';
import { intParam, json, readJson, route, searchParams } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  states: z.array(z.string().trim().length(2)).max(20).optional(),
  counties: z.array(z.string().trim().max(60)).max(30).optional(),
  cities: z.array(z.string().trim().max(60)).max(30).optional(),
  zips: z.array(z.string().trim().max(10)).max(100).optional(),
  minUnits: z.number().int().min(0).max(1_000_000).optional(),
  maxUnits: z.number().int().min(0).max(10_000_000).optional(),
  minBuildings: z.number().int().min(0).max(100_000).optional(),
  maxBuildings: z.number().int().min(0).max(100_000).optional(),
  minBuildingUnits: z.number().int().min(1).max(5000).optional(),
  ownerType: z.enum(['any', 'owner_operator', 'property_manager', 'public_housing', 'nonprofit']).optional(),
  keywords: z.array(z.string().trim().max(60)).max(10).optional(),
  limit: z.number().int().min(5).max(200).optional(),
});

/** Start a lead search. Research begins immediately and continues in the background. */
export const POST = route(async (request) => {
  const ctx = await requireMember();
  const body = await readJson(request, schema);
  const id = await createDiscoverJob(ctx.workspaceId, ctx.userId, body);
  after(async () => {
    await pumpJob(id, 45_000).catch(() => undefined);
  });
  return json({ id }, 201);
});

export const GET = route(async (request) => {
  const ctx = await requireMember();
  const limit = intParam(searchParams(request).get('limit'), 25, 1, 100);
  const rows = await sql()`
    select j.id, j.kind, j.title, j.status, j.progress, j.stage, j.stats, j.error, j.created_at, j.finished_at, j.target_company_id,
      (select count(*)::int from lead_candidates c where c.job_id = j.id) as candidates,
      (select count(*)::int from lead_candidates c where c.job_id = j.id and c.status = 'saved') as saved
    from research_jobs j where j.workspace_id = ${ctx.workspaceId}
    order by j.created_at desc limit ${limit}`;
  return json({ jobs: rows });
});
