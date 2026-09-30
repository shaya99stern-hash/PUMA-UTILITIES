import 'server-only';
import { sql, type Sql, type Tx } from '@/lib/server/db';
import type { ActivityRow, ActivityType } from './types';

export type LogActivityInput = {
  workspaceId: string;
  companyId?: string | null;
  contactId?: string | null;
  propertyId?: string | null;
  type: ActivityType;
  subject?: string | null;
  body?: string | null;
  meta?: Record<string, unknown>;
  userId?: string | null;
  /** Defaults to now. */
  occurredAt?: Date | string | null;
  /** Pass a transaction to join it. */
  db?: Sql | Tx;
};

/** Activity types that count as a real touch with the company (bumps last_contacted_at). */
const CONTACT_TYPES = new Set<ActivityType>(['call', 'meeting', 'email_out', 'email_in']);

/**
 * Appends an entry to the activity timeline and bumps companies.last_activity_at
 * (plus last_contacted_at for calls/meetings/emails). If only a contactId or propertyId is
 * given, the company is resolved from it. Never throws for a missing company link.
 */
export async function logActivity(input: LogActivityInput): Promise<ActivityRow> {
  const db = (input.db ?? sql()) as Sql;
  let companyId = input.companyId ?? null;
  if (!companyId && input.contactId) {
    const r = await db<{ company_id: string | null }[]>`select company_id from contacts where id = ${input.contactId} and workspace_id = ${input.workspaceId}`;
    companyId = r[0]?.company_id ?? null;
  }
  if (!companyId && input.propertyId) {
    const r = await db<{ company_id: string | null }[]>`select company_id from properties where id = ${input.propertyId} and workspace_id = ${input.workspaceId}`;
    companyId = r[0]?.company_id ?? null;
  }
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  const rows = await db<ActivityRow[]>`
    insert into activities (workspace_id, company_id, contact_id, property_id, type, subject, body, meta, occurred_at, created_by)
    values (${input.workspaceId}, ${companyId}, ${input.contactId ?? null}, ${input.propertyId ?? null}, ${input.type},
            ${input.subject ?? null}, ${input.body ?? null}, ${db.json((input.meta ?? {}) as never)}, ${occurredAt}, ${input.userId ?? null})
    returning *`;
  if (companyId) {
    const touched = CONTACT_TYPES.has(input.type);
    await db`
      update companies set
        last_activity_at = greatest(coalesce(last_activity_at, ${occurredAt}), ${occurredAt}),
        last_contacted_at = case when ${touched} then greatest(coalesce(last_contacted_at, ${occurredAt}), ${occurredAt}) else last_contacted_at end
      where id = ${companyId} and workspace_id = ${input.workspaceId}`;
  }
  if (input.contactId && CONTACT_TYPES.has(input.type)) {
    await db`update contacts set last_contacted_at = ${occurredAt} where id = ${input.contactId} and workspace_id = ${input.workspaceId}`;
  }
  return rows[0];
}
