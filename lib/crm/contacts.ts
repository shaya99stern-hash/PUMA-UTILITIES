import 'server-only';
import { normalizeEmail, normalizePhone, splitName } from '@/lib/text';
import { ApiError } from '@/lib/server/http';
import { escapeLike, pgError, sql } from './server';
import type { Sql } from '@/lib/server/db';

/** Normalizes contact input and keeps full_name/first/last consistent. */
export function prepareContactFields(input: Record<string, unknown>, existing?: { first_name: string | null; last_name: string | null; full_name: string }): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  const first = input.first_name as string | null | undefined;
  const last = input.last_name as string | null | undefined;
  const full = input.full_name as string | undefined;
  if (full !== undefined) {
    if (first === undefined && last === undefined) {
      const s = splitName(full);
      out.first_name = s.first;
      out.last_name = s.last;
    }
  } else if (first !== undefined || last !== undefined) {
    const f = first !== undefined ? first : existing?.first_name ?? null;
    const l = last !== undefined ? last : existing?.last_name ?? null;
    const name = [f, l].filter(Boolean).join(' ').trim();
    if (name) out.full_name = name;
  }
  if (input.email !== undefined) {
    const e = input.email ? normalizeEmail(input.email as string) : null;
    if (input.email && !e) throw new ApiError(400, 'That email address does not look valid.');
    out.email = e;
  }
  if (input.phone !== undefined) out.phone = input.phone ? normalizePhone(input.phone as string) : null;
  if (input.mobile !== undefined) out.mobile = input.mobile ? normalizePhone(input.mobile as string) : null;
  return out;
}

export async function throwContactConflict(error: unknown, workspaceId: string, email: unknown): Promise<never> {
  if (pgError(error).code === '23505' && typeof email === 'string') {
    const rows = await sql()<{ id: string; full_name: string }[]>`select id, full_name from contacts where workspace_id = ${workspaceId} and email = ${email} limit 1`;
    throw new ApiError(409, rows[0] ? `${rows[0].full_name} already uses that email address.` : 'A contact with that email already exists.', { existingId: rows[0]?.id ?? null });
  }
  throw error;
}

export async function assertCompany(workspaceId: string, companyId: string | null | undefined) {
  if (!companyId) return;
  const rows = await sql()`select 1 from companies where id = ${companyId} and workspace_id = ${workspaceId}`;
  if (!rows.length) throw new ApiError(400, 'That company does not exist.');
}

export function contactConditions(db: Sql, workspaceId: string, p: URLSearchParams) {
  const parts = [db`ct.workspace_id = ${workspaceId}`];
  const q = p.get('q')?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    parts.push(db`(ct.full_name ilike ${like} or ct.email::text ilike ${like} or ct.title ilike ${like} or co.name ilike ${like})`);
  }
  if (p.get('companyId')) parts.push(db`ct.company_id = ${p.get('companyId')}`);
  if (p.get('decisionMaker') === '1') parts.push(db`ct.is_decision_maker`);
  if (p.get('hasEmail') === '1') parts.push(db`ct.email is not null`);
  if (p.get('emailStatus')) parts.push(db`ct.email_status = ${p.get('emailStatus')}`);
  if (p.get('role')) parts.push(db`ct.role_category = ${p.get('role')}`);
  if (p.get('stage')) parts.push(db`co.stage = ${p.get('stage')}`);
  return parts.reduce((acc, part, i) => (i ? db`${acc} and ${part}` : part));
}

