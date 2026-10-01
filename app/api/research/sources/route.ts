import { BUILT_IN_SOURCES } from '@/lib/engine/catalog';
import { requireMember } from '@/lib/server/auth';
import { sql } from '@/lib/server/db';
import { json, route } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

/** Built-in sources with live health, plus the user's connectors. */
export const GET = route(async () => {
  const ctx = await requireMember();
  const db = sql();
  const health = await db<{ source_id: string; ok_count: number; error_count: number; last_ok_at: string | null; last_error_at: string | null; last_error: string | null; avg_ms: number | null; disabled_until: string | null }[]>`select * from source_health`;
  const byId = new Map(health.map((h) => [h.source_id, h]));
  const connectors = await db`select id, name, kind, role, enabled, daily_limit, usage, last_test from connectors where workspace_id = ${ctx.workspaceId} order by created_at`;
  const sources = BUILT_IN_SOURCES.map((s) => {
    const h = byId.get(s.id);
    const status = h?.disabled_until && new Date(h.disabled_until) > new Date() ? 'paused' : h?.last_ok_at && (!h.last_error_at || h.last_ok_at > h.last_error_at) ? 'ok' : h?.last_error_at ? 'error' : s.verified === 'needs-key' ? 'needs-key' : 'ready';
    return { ...s, label: s.name, status, health: h ? { ok: h.ok_count, errors: h.error_count, lastOk: h.last_ok_at, lastError: h.last_error, avgMs: h.avg_ms } : null };
  });
  return json({ sources, connectors });
});
