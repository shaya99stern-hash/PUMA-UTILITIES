import { saveCandidate } from '@/lib/engine/save';
import { requireMember } from '@/lib/server/auth';
import { json, route } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Saves a lead into the CRM (company + decision makers + buildings + evidence). */
export const POST = route(async (_request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireMember();
  const { id } = await params;
  const result = await saveCandidate(ctx.workspaceId, ctx.userId, id);
  return json(result);
});
