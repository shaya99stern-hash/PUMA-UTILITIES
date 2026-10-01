import 'server-only';
import { z } from 'zod';
import { sql, type Sql, type Tx } from '@/lib/server/db';
import { ApiError } from '@/lib/server/http';

export type Db = Sql | Tx;

export type IdContext = { params: Promise<{ id: string }> };

/** Resolves and validates `[id]` from route context. 404 when not a UUID. */
export async function getId(context: IdContext): Promise<string> {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(404, 'Not found.');
  return id;
}

/** Postgres error code helper (postgres.js errors carry `code` and `constraint_name`). */
export function pgError(error: unknown): { code?: string; constraint?: string; detail?: string } {
  const e = error as { code?: string; constraint_name?: string; detail?: string } | null;
  return { code: e?.code, constraint: e?.constraint_name, detail: e?.detail };
}

/**
 * Builds and runs a partial UPDATE from a patch object (undefined keys are skipped).
 * Array columns are listed in `arrayCols` so they serialize as text[].
 */
export async function patchRow<T>(
  db: Db,
  table: 'companies' | 'contacts' | 'properties' | 'tasks' | 'payables' | 'meters',
  id: string,
  workspaceId: string,
  patch: Record<string, unknown>,
  arrayCols: string[] = [],
): Promise<T | null> {
  const d = db as Sql;
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (!keys.length) {
    const rows = await d`select * from ${d(table)} where id = ${id} and workspace_id = ${workspaceId}`;
    return (rows[0] as T) ?? null;
  }
  const sets = keys.map((k, i) => {
    const v = patch[k];
    const frag = arrayCols.includes(k) ? d`${d.array((v as string[]) ?? [], 1009)}` : d`${v as never}`;
    return d`${i ? d`, ` : d``}${d(k)} = ${frag}`;
  });
  const rows = await d`update ${d(table)} set ${sets} where id = ${id} and workspace_id = ${workspaceId} returning *`;
  return (rows[0] as T) ?? null;
}

/** Keeps companies.next_follow_up_at equal to the earliest open task due date. */
export async function syncFollowUp(db: Db, workspaceId: string, companyId: string | null | undefined) {
  if (!companyId) return;
  const d = db as Sql;
  await d`
    update companies set next_follow_up_at = (
      select min(due_at) from tasks where company_id = ${companyId} and workspace_id = ${workspaceId} and status = 'open' and due_at is not null
    ) where id = ${companyId} and workspace_id = ${workspaceId}`;
}

/** Validates an IANA time zone name, falling back to New York. */
export function safeTimeZone(tz: string | null): string {
  if (!tz) return 'America/New_York';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'America/New_York';
  }
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export { sql };

/** Date-only column value (postgres.js returns a Date at UTC midnight) -> 'YYYY-MM-DD'. */
export function dateOnly(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value as Date).toISOString().slice(0, 10);
}
