import { after } from 'next/server';
import { z } from 'zod';
import { createEnrichJob, pumpJob } from '@/lib/engine/jobs';
import { requireMember } from '@/lib/server/auth';
import { json, readJson, route } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Deep research on an existing CRM company (cross-references every source again). */
export const POST = route(async (request) => {
  const ctx = await requireMember();
  const { companyId } = await readJson(request, z.object({ companyId: z.string().uuid() }));
  const id = await createEnrichJob(ctx.workspaceId, ctx.userId, companyId);
  after(async () => {
    await pumpJob(id, 45_000).catch(() => undefined);
  });
  return json({ id, jobId: id }, 201);
});
