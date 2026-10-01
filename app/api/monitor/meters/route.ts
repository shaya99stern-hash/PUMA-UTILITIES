import { z } from 'zod';
import { requireMember } from '@/lib/server/auth';
import { ApiError, json, readJson, route } from '@/lib/server/http';
import { sql } from '@/lib/server/db';
import type { MeterRow } from '@/lib/crm/types';

export const runtime = 'nodejs';

const schema = z.object({
  property_id: z.string().uuid(),
  label: z.string().trim().min(1).max(120),
  utility_account: z.string().trim().max(80).nullish(),
  meter_number: z.string().trim().max(80).nullish(),
  meter_type: z.string().trim().max(40).optional(),
}).strict();

export const POST = route(async (request) => {
  const ctx = await requireMember();
  const body = await readJson(request, schema);
  const db = sql();
  const ok = await db`
    select 1 from properties pr join companies co on co.id = pr.company_id
    where pr.id = ${body.property_id} and pr.workspace_id = ${ctx.workspaceId} and co.stage = 'client'`;
  if (!ok.length) throw new ApiError(409, 'Meters can only be added to properties of client companies.');
  const rows = await db<MeterRow[]>`
    insert into meters (workspace_id, property_id, label, utility_account, meter_number, meter_type)
    values (${ctx.workspaceId}, ${body.property_id}, ${body.label}, ${body.utility_account || null}, ${body.meter_number || null}, ${body.meter_type || 'water'})
    returning *`;
  return json({ meter: rows[0] }, 201);
});
