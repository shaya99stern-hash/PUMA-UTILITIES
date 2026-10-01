import { z } from 'zod';
import { saveCandidate } from '@/lib/engine/save';
import { requireMember } from '@/lib/server/auth';
import { json, readJson, route } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = route(async (request) => {
  const ctx = await requireMember();
  const { ids } = await readJson(request, z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }));
  const results: { id: string; companyId?: string; error?: string }[] = [];
  for (const id of ids) {
    try {
      const r = await saveCandidate(ctx.workspaceId, ctx.userId, id);
      results.push({ id, companyId: r.companyId });
    } catch (error) {
      results.push({ id, error: (error as Error).message });
    }
  }
  return json({ results, saved: results.filter((r) => r.companyId).length });
});
