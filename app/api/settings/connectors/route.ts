import { CONNECTOR_PRESETS } from '@/lib/engine/connectors';
import { requireMember } from '@/lib/server/auth';
import { encryptSecret } from '@/lib/server/crypto';
import { sql } from '@/lib/server/db';
import { json, readJson, route } from '@/lib/server/http';
import { connectorSchema } from '@/lib/engine/connector-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


function publicRow(r: Record<string, unknown>) {
  const { secret_enc, ...rest } = r;
  return { ...rest, hasSecret: Boolean(secret_enc) };
}

export const GET = route(async () => {
  const ctx = await requireMember();
  const rows = await sql()<Record<string, unknown>[]>`select * from connectors where workspace_id = ${ctx.workspaceId} order by created_at`;
  return json({ connectors: rows.map(publicRow), presets: CONNECTOR_PRESETS });
});

export const POST = route(async (request) => {
  const ctx = await requireMember('admin');
  const body = await readJson(request, connectorSchema);
  const preset = CONNECTOR_PRESETS.find((p) => p.kind === body.kind && p.role === body.role);
  const db = sql();
  const [row] = await db<Record<string, unknown>[]>`
    insert into connectors (workspace_id, name, kind, role, enabled, config, secret_enc, daily_limit)
    values (${ctx.workspaceId}, ${body.name}, ${body.kind}, ${body.role}, ${body.enabled ?? true}, ${db.json(body.config as never)},
      ${body.secret ? encryptSecret(body.secret.trim()) : null}, ${body.dailyLimit ?? preset?.dailyLimit ?? 100})
    returning *`;
  return json({ connector: publicRow(row) }, 201);
});
