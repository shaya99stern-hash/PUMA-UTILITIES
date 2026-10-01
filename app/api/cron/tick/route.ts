import { safeEqual } from '@/lib/server/crypto';
import { sql } from '@/lib/server/db';
import { ApiError, json, route } from '@/lib/server/http';
import { runEmailTick } from '@/lib/email/campaigns';
import { loadMailbox } from '@/lib/email/mailboxes';
import { requestOrigin } from '@/lib/email/oauth';
import { syncMailbox, type SyncResult } from '@/lib/email/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.PUMA_CRON_SECRET?.trim();
  const header = request.headers.get('x-cron-secret');
  if (secret && header && safeEqual(header, secret)) return true;
  const vercel = process.env.CRON_SECRET?.trim();
  const bearer = request.headers.get('authorization');
  if (vercel && bearer && safeEqual(bearer, `Bearer ${vercel}`)) return true;
  return false;
}

/**
 * One scheduler tick: send due campaign emails, sync mailboxes that have not been synced in 5 minutes,
 * then run research jobs. Call every minute with header `x-cron-secret: $PUMA_CRON_SECRET`
 * (Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically).
 */
async function handler(request: Request) {
  if (!authorized(request)) throw new ApiError(401, 'Unauthorized.');
  const started = Date.now();
  const origin = requestOrigin(request);
  const result: Record<string, unknown> = {};

  try {
    result.email = await runEmailTick({ budgetMs: 20_000, baseUrl: origin });
  } catch (error) {
    result.email = { error: error instanceof Error ? error.message : 'Email tick failed.' };
  }

  try {
    const due = await sql()<{ id: string; workspace_id: string }[]>`
      select id, workspace_id from mailboxes
      where status <> 'disconnected' and (last_sync_at is null or last_sync_at < now() - interval '5 minutes')
      order by last_sync_at nulls first limit 6`;
    const syncDeadline = started + 40_000;
    const synced: SyncResult[] = [];
    for (const row of due) {
      if (Date.now() > syncDeadline - 5000) break;
      const mailbox = await loadMailbox(row.workspace_id, row.id).catch(() => null);
      if (mailbox) synced.push(await syncMailbox(mailbox, { limit: 30, deadline: syncDeadline }));
    }
    result.mailboxes = synced;
  } catch (error) {
    result.mailboxes = { error: error instanceof Error ? error.message : 'Mailbox sync failed.' };
  }

  try {
    // The research engine lives in lib/engine (separate owner); a failure there must never break email.
    // @ts-ignore - resolved at build time once lib/engine/tick.ts exists
    const mod = (await import('@/lib/engine/tick')) as { runResearchTick?: (opts: { budgetMs: number }) => Promise<unknown> };
    result.research = mod.runResearchTick ? await mod.runResearchTick({ budgetMs: 20_000 }) : { skipped: 'runResearchTick is not exported' };
  } catch (error) {
    result.research = { skipped: error instanceof Error ? error.message : 'Research tick unavailable.' };
  }

  return json({ ok: true, durationMs: Date.now() - started, ...result });
}

export const GET = route(handler);
export const POST = route(handler);
