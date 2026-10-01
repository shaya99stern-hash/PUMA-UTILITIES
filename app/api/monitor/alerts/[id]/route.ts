import { z } from 'zod';
import { requireMember } from '@/lib/server/auth';
import { ApiError, json, readJson, route } from '@/lib/server/http';
import { sql } from '@/lib/server/db';
import { getId, type IdContext } from '@/lib/crm/server';
import type { AlertRow } from '@/lib/crm/types';

export const runtime = 'nodejs';

export const PATCH = route<IdContext>(async (request, context) => {
  const ctx = await requireMember();
  const id = await getId(context);
  const { status } = await readJson(request, z.object({ status: z.enum(['open', 'acknowledged', 'resolved']) }).strict());
  const rows = await sql()<AlertRow[]>`
    update alerts set status = ${status}, resolved_at = ${status === 'resolved' ? new Date() : null}
    where id = ${id} and workspace_id = ${ctx.workspaceId} returning *`;
  if (!rows[0]) throw new ApiError(404, 'Alert not found.');
  return json({ alert: rows[0] });
});
