import { z } from 'zod';
import { requireMember } from '@/lib/server/auth';
import { ApiError, json, readJson, route } from '@/lib/server/http';
import { sql } from '@/lib/server/db';
import { detectReadingAlerts } from '@/lib/crm/alerts';
import type { AlertRow, MeterReadingRow } from '@/lib/crm/types';

export const runtime = 'nodejs';

const schema = z.object({
  meter_id: z.string().uuid(),
  period_start: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).nullish(),
  period_end: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)),
  gallons: z.number().nonnegative().max(1e10).nullish(),
  cost: z.number().nonnegative().max(1e9).nullish(),
  continuous_flow: z.boolean().optional(),
  min_night_gph: z.number().nonnegative().max(1e7).nullish(),
  spend_threshold: z.number().positive().nullish(),
}).strict().refine((v) => v.gallons !== null && v.gallons !== undefined || v.cost !== null && v.cost !== undefined, { message: 'Enter gallons or cost.' });

/** Manual reading entry. Client-stage meters only; creates alerts for continuous flow and spikes. */
export const POST = route(async (request) => {
  const ctx = await requireMember();
  const body = await readJson(request, schema);
  const db = sql();
  const meters = await db<{ id: string; label: string; property_id: string; property_name: string; stage: string }[]>`
    select m.id, m.label, m.property_id, coalesce(pr.name, pr.address) as property_name, co.stage
    from meters m join properties pr on pr.id = m.property_id left join companies co on co.id = pr.company_id
    where m.id = ${body.meter_id} and m.workspace_id = ${ctx.workspaceId}`;
  const meter = meters[0];
  if (!meter) throw new ApiError(404, 'Meter not found.');
  if (meter.stage !== 'client') throw new ApiError(409, 'Readings are only accepted for client properties.');

  const periodEnd = new Date(body.period_end);
  const history = await db<{ period_start: Date | null; period_end: Date; gallons: number | null; period_end_iso: string }[]>`
    select period_start, period_end, gallons from meter_readings
    where meter_id = ${meter.id} and period_end < ${periodEnd} order by period_end desc limit 6`;
  // Default the period start to the previous reading's end so daily rates are comparable.
  const periodStart = body.period_start ? new Date(body.period_start) : history[0]?.period_end ?? null;
  if (periodStart && periodStart.getTime() >= periodEnd.getTime()) throw new ApiError(400, 'Period end must be after period start.');

  const detected = detectReadingAlerts(
    { periodStart, periodEnd, gallons: body.gallons ?? null, cost: body.cost ?? null, flags: { continuous_flow: body.continuous_flow, min_night_gph: body.min_night_gph ?? null } },
    history.map((h) => ({ periodStart: h.period_start, periodEnd: h.period_end, gallons: h.gallons })),
    { label: meter.label, propertyName: meter.property_name, spendThreshold: body.spend_threshold ?? null },
  );

  const result = await db.begin(async (tx) => {
    const flags = { ...(body.continuous_flow ? { continuous_flow: true } : {}), ...(body.min_night_gph != null ? { min_night_gph: body.min_night_gph } : {}), detected: detected.map((d) => d.kind) };
    const readings = await tx<MeterReadingRow[]>`
      insert into meter_readings (workspace_id, meter_id, period_start, period_end, gallons, cost, source, flags)
      values (${ctx.workspaceId}, ${meter.id}, ${periodStart}, ${periodEnd}, ${body.gallons ?? null}, ${body.cost ?? null}, 'manual', ${tx.json(flags)})
      returning *`;
    const created: AlertRow[] = [];
    for (const alert of detected) {
      // One open alert per meter and kind; repeated readings do not spam.
      const dup = await tx`select 1 from alerts where meter_id = ${meter.id} and kind = ${alert.kind} and status = 'open'`;
      if (dup.length) continue;
      const rows = await tx<AlertRow[]>`
        insert into alerts (workspace_id, property_id, meter_id, reading_id, kind, severity, title, detail)
        values (${ctx.workspaceId}, ${meter.property_id}, ${meter.id}, ${readings[0].id}, ${alert.kind}, ${alert.severity}, ${alert.title}, ${alert.detail})
        returning *`;
      created.push(rows[0]);
    }
    return { reading: readings[0], alerts: created };
  });
  return json({ ...result, detected: detected.length }, 201);
});
