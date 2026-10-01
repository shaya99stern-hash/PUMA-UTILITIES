import { z } from 'zod';
import { requireMember } from '@/lib/server/auth';
import { ApiError, json, route } from '@/lib/server/http';
import { sql } from '@/lib/server/db';
import { parseCsvObjects } from '@/lib/crm/csv';
import { mapImportRows } from '@/lib/crm/import-map';
import { companyNameKey } from '@/lib/text';
import { stageSchema } from '@/lib/crm/schemas';
import { logActivity } from '@/lib/crm/activity';

export const runtime = 'nodejs';

const MAX_ROWS = 5000;
const bodySchema = z.object({
  csv: z.string().max(8_000_000).optional(),
  rows: z.array(z.record(z.string(), z.unknown())).max(MAX_ROWS).optional(),
  dryRun: z.boolean().optional(),
  defaultStage: stageSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
});

/**
 * Imports companies (+ one contact per row) from CSV text or JSON rows with flexible headers.
 * Accepts `{ csv }`, `{ rows }`, or a raw text/csv body. Dedupes by company name key and domain,
 * and contacts by email. Returns counts; `dryRun` returns the same counts without writing.
 */
export const POST = route(async (request) => {
  const ctx = await requireMember();
  const contentType = request.headers.get('content-type') ?? '';
  let input: z.infer<typeof bodySchema>;
  if (contentType.includes('application/json')) {
    try { input = bodySchema.parse(await request.json()); } catch (e) {
      if (e instanceof z.ZodError) throw e;
      throw new ApiError(400, 'Request body must be JSON.');
    }
  } else {
    input = { csv: await request.text() };
  }
  const raw: Array<Record<string, unknown>> = input.rows ?? (input.csv ? parseCsvObjects(input.csv) : []);
  if (!raw.length) throw new ApiError(400, 'No rows found. Include a header row and at least one data row.');
  if (raw.length > MAX_ROWS) throw new ApiError(400, `Import up to ${MAX_ROWS.toLocaleString()} rows at a time.`);

  const { rows, skipped, mapping } = mapImportRows(raw);
  if (!Object.values(mapping).includes('company') && !Object.values(mapping).includes('website')) {
    throw new ApiError(400, 'Could not find a company name column. Name a header "Company" or "Company name".');
  }
  const db = sql();
  const ws = ctx.workspaceId;
  const counts = { total: raw.length, created: 0, existing: 0, contacts_created: 0, contacts_existing: 0, skipped: skipped.length };
  const createdIds: string[] = [];

  const existing = await db<{ id: string; name_key: string; domain: string | null }[]>`select id, name_key, domain from companies where workspace_id = ${ws}`;
  const byKey = new Map(existing.map((c) => [c.name_key, c.id]));
  const byDomain = new Map(existing.filter((c) => c.domain).map((c) => [c.domain as string, c.id]));
  const knownEmails = new Set((await db<{ email: string }[]>`select email::text as email from contacts where workspace_id = ${ws} and email is not null`).map((c) => c.email));

  const run = async (tx: typeof db, dry: boolean) => {
    for (const row of rows) {
      const key = companyNameKey(row.company);
      let companyId = byKey.get(key) ?? (row.domain ? byDomain.get(row.domain) : undefined);
      if (companyId) counts.existing += 1;
      else {
        if (dry) companyId = `dry-${key}`;
        else {
          const tags = [...new Set([...(row.tags ?? []), ...(input.tags ?? [])])];
          const inserted = await tx<{ id: string }[]>`
            insert into companies (workspace_id, name, name_key, domain, website, phone, email, address, city, state, zip, company_type, stage,
              portfolio_buildings, portfolio_units, tags, source, created_by)
            values (${ws}, ${row.company}, ${key}, ${row.domain}, ${row.website}, ${row.phone}, ${row.email}, ${row.address}, ${row.city}, ${row.state}, ${row.zip},
              ${row.company_type ?? 'unknown'}, ${row.stage !== 'new' ? row.stage : input.defaultStage ?? 'new'}, ${row.buildings}, ${row.units},
              ${tx.array(tags, 1009)}, 'import', ${ctx.userId})
            on conflict do nothing returning id`;
          companyId = inserted[0]?.id;
          if (!companyId) { counts.existing += 1; continue; }
          createdIds.push(companyId);
        }
        counts.created += 1;
        byKey.set(key, companyId);
        if (row.domain) byDomain.set(row.domain, companyId);
      }
      if (row.contact) {
        const email = row.contact.email;
        if (email && knownEmails.has(email)) counts.contacts_existing += 1;
        else {
          if (email) knownEmails.add(email);
          if (!dry) {
            const res = await tx`
              insert into contacts (workspace_id, company_id, first_name, last_name, full_name, title, email, email_status, phone, source, created_by, is_decision_maker)
              values (${ws}, ${companyId}, ${row.contact.first_name}, ${row.contact.last_name}, ${row.contact.full_name}, ${row.contact.title}, ${email},
                ${email ? 'unknown' : 'unknown'}, ${row.contact.phone}, 'import', ${ctx.userId}, ${!!row.contact.title && /owner|president|ceo|director|vp|principal|founder/i.test(row.contact.title)})
              on conflict do nothing returning id`;
            if (res.length) counts.contacts_created += 1; else counts.contacts_existing += 1;
          } else counts.contacts_created += 1;
        }
      }
    }
  };

  if (input.dryRun) await run(db, true);
  else {
    await db.begin(async (tx) => { await run(tx as unknown as typeof db, false); });
    for (const id of createdIds.slice(0, 200)) {
      await logActivity({ workspaceId: ws, companyId: id, type: 'system', subject: 'Imported from CSV', userId: ctx.userId });
    }
  }
  return json({ ok: true, dryRun: !!input.dryRun, ...counts, mapping, skippedRows: skipped.slice(0, 50) });
});
