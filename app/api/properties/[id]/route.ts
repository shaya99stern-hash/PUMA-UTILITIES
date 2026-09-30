import { requireMember } from '@/lib/server/auth';
import { ApiError, json, readJson, route } from '@/lib/server/http';
import { sql } from '@/lib/server/db';
import { assertCompany } from '@/lib/crm/contacts';
import { propertyPatchSchema } from '@/lib/crm/schemas';
import { getId, patchRow, type IdContext } from '@/lib/crm/server';
import type { ActivityListRow, AlertRow, EvidenceRow, MeterReadingRow, MeterRow, PropertyRow } from '@/lib/crm/types';

export const runtime = 'nodejs';

export const GET = route<IdContext>(async (_request, context) => {
  const ctx = await requireMember();
  const id = await getId(context);
  const db = sql();
  const rows = await db<PropertyRow[]>`select * from properties where id = ${id} and workspace_id = ${ctx.workspaceId}`;
  if (!rows[0]) throw new ApiError(404, 'Property not found.');
  const property = rows[0];
  const [company, meters, alerts, activities, evidence] = await Promise.all([
    property.company_id
      ? db<{ id: string; name: string; stage: string; domain: string | null }[]>`select id, name, stage, domain from companies where id = ${property.company_id} and workspace_id = ${ctx.workspaceId}`
      : Promise.resolve([]),
    db<MeterRow[]>`select * from meters where property_id = ${id} and workspace_id = ${ctx.workspaceId} order by created_at`,
    db<AlertRow[]>`select * from alerts where property_id = ${id} and workspace_id = ${ctx.workspaceId} order by detected_at desc limit 50`,
    db<ActivityListRow[]>`select a.* from activities a where a.property_id = ${id} and a.workspace_id = ${ctx.workspaceId} order by a.occurred_at desc limit 50`,
    db<EvidenceRow[]>`select * from evidence where entity_type = 'property' and entity_id = ${id} and workspace_id = ${ctx.workspaceId} order by retrieved_at desc limit 100`,
  ]);
  // Readings are client-authorized data: only expose them when the owning company is a client.
  const isClient = company[0]?.stage === 'client';
  const readings = isClient && meters.length
    ? await db<MeterReadingRow[]>`
        select * from (
          select r.*, row_number() over (partition by r.meter_id order by r.period_end desc) as rn
          from meter_readings r where r.workspace_id = ${ctx.workspaceId} and r.meter_id in ${db(meters.map((m) => m.id))}
        ) t where rn <= 12 order by period_end desc`
    : [];
  return json({ property, company: company[0] ?? null, meters: isClient ? meters : [], readings, alerts: isClient ? alerts : [], activities, evidence, monitoring: isClient });
});

export const PATCH = route<IdContext>(async (request, context) => {
  const ctx = await requireMember();
  const id = await getId(context);
  const body = await readJson(request, propertyPatchSchema);
  if (body.company_id) await assertCompany(ctx.workspaceId, body.company_id as string);
  const patch: Record<string, unknown> = { ...body };
  if (typeof patch.state === 'string') patch.state = patch.state.toUpperCase().slice(0, 40);
  const row = await patchRow<PropertyRow>(sql(), 'properties', id, ctx.workspaceId, patch);
  if (!row) throw new ApiError(404, 'Property not found.');
  return json({ property: row });
});

export const DELETE = route<IdContext>(async (_request, context) => {
  const ctx = await requireMember();
  const id = await getId(context);
  const rows = await sql()`delete from properties where id = ${id} and workspace_id = ${ctx.workspaceId} returning id`;
  if (!rows.length) throw new ApiError(404, 'Property not found.');
  return json({ ok: true, id });
});
