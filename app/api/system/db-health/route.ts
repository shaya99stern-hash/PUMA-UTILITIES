import { sql } from '@/lib/server/db';
import { json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

/** Reports whether the server can reach the Puma v2 database. No data is exposed. */
export async function GET() {
  const started = Date.now();
  if (!process.env.DATABASE_URL) {
    return json({ ok: false, database: 'not-configured', error: 'DATABASE_URL is not set.' }, 503);
  }
  try {
    const rows = await sql()<{ workspaces: number; now: string }[]>`
      select (select count(*)::int from workspaces) as workspaces, now()::text as now`;
    return json({ ok: true, database: 'connected', latencyMs: Date.now() - started, workspaces: rows[0]?.workspaces ?? 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, database: 'error', latencyMs: Date.now() - started, error: message.slice(0, 200) }, 503);
  }
}
