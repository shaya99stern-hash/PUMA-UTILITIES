import { z } from 'zod';
import { inputKeyFor, testConnector, type ConnectorRow } from '@/lib/engine/connectors';
import { requireMember } from '@/lib/server/auth';
import { decryptSecret } from '@/lib/server/crypto';
import { sql } from '@/lib/server/db';
import { ApiError, json, route } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Runs the connector once with a sample input and stores the result. */
export const POST = route(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireMember();
  const { id } = await params;
  const sample = z.object({ state: z.string().length(2).optional(), name: z.string().max(120).optional(), domain: z.string().max(120).optional() }).parse(await request.json().catch(() => ({})));
  const db = sql();
  const [row] = await db<ConnectorRow[]>`select * from connectors where id = ${id} and workspace_id = ${ctx.workspaceId}`;
  if (!row) throw new ApiError(404, 'Connector not found.');
  let secret: string | null = null;
  try {
    secret = row.secret_enc ? decryptSecret(row.secret_enc) : null;
  } catch {
    secret = null;
  }
  const result = await testConnector({ id: row.id, name: row.name, kind: row.kind, role: row.role, config: row.config ?? {}, secret, dailyLimit: row.daily_limit, inputKey: inputKeyFor(row.kind, row.role, row.config ?? {}) }, sample);
  await db`update connectors set last_test = ${db.json({ ...result, at: new Date().toISOString() } as never)} where id = ${id}`;
  return json(result);
});
