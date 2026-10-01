import { requireMember } from '@/lib/server/auth';
import { encryptSecret } from '@/lib/server/crypto';
import { sql } from '@/lib/server/db';
import { ApiError, json, readJson, route } from '@/lib/server/http';
import { connectorSchema } from '@/lib/engine/connector-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = route(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireMember('admin');
  const { id } = await params;
  const body = await readJson(request, connectorSchema.partial());
  const db = sql();
  const [row] = await db<Record<string, unknown>[]>`
    update connectors set
      name = coalesce(${body.name ?? null}, name),
      enabled = coalesce(${body.enabled ?? null}, enabled),
      config = case when ${body.config ? true : false} then ${db.json((body.config ?? {}) as never)} else config end,
      secret_enc = case when ${body.secret !== undefined} then ${body.secret ? encryptSecret(body.secret.trim()) : null} else secret_enc end,
      daily_limit = coalesce(${body.dailyLimit ?? null}, daily_limit)
    where id = ${id} and workspace_id = ${ctx.workspaceId}
    returning *`;
  if (!row) throw new ApiError(404, 'Connector not found.');
  const { secret_enc, ...rest } = row;
  return json({ connector: { ...rest, hasSecret: Boolean(secret_enc) } });
});

export const DELETE = route(async (_request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireMember('admin');
  const { id } = await params;
  await sql()`delete from connectors where id = ${id} and workspace_id = ${ctx.workspaceId}`;
  return json({ ok: true });
});
