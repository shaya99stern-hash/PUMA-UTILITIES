import 'server-only';
import { sql } from '@/lib/server/db';
import { escapeHtml } from './merge';
import { refreshCampaignStats } from './stats';

const TOKEN = /^[0-9a-f]{32}$/i;
export const isToken = (t: string) => TOKEN.test(t);

type Found = { id: string; workspace_id: string; campaign_id: string; contact_id: string | null; company_id: string | null; email: string; status: string; campaign_name: string; unsubscribed_at: Date | null };

export async function findRecipient(token: string): Promise<Found | null> {
  if (!isToken(token)) return null;
  const rows = await sql()<Found[]>`
    select r.id, r.workspace_id, r.campaign_id, r.contact_id, r.company_id, r.email::text as email, r.status, r.unsubscribed_at, c.name as campaign_name
    from campaign_recipients r join campaigns c on c.id = r.campaign_id where r.token = ${token}`;
  return rows[0] ?? null;
}

export function maskEmail(email: string) {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(1, Math.min(6, local.length - 1)))}@${domain}`;
}

/** Marks the recipient and contact unsubscribed, suppresses the address, and stops every pending send to it. */
export async function unsubscribe(token: string, via: 'page' | 'one-click'): Promise<Found | null> {
  const r = await findRecipient(token);
  if (!r) return null;
  const db = sql();
  const first = !r.unsubscribed_at;
  await db`
    update campaign_recipients set status = case when status = 'bounced' then status else 'unsubscribed' end, unsubscribed_at = coalesce(unsubscribed_at, now()), next_send_at = null
    where id = ${r.id}`;
  await db`insert into suppressions (workspace_id, email, reason) values (${r.workspace_id}, ${r.email}, 'unsubscribed') on conflict (workspace_id, email) do nothing`;
  await db`update contacts set unsubscribed_at = coalesce(unsubscribed_at, now()) where workspace_id = ${r.workspace_id} and email = ${r.email}`;
  const others = await db<{ campaign_id: string }[]>`
    update campaign_recipients set status = 'unsubscribed', unsubscribed_at = coalesce(unsubscribed_at, now()), next_send_at = null
    where workspace_id = ${r.workspace_id} and email = ${r.email} and id <> ${r.id} and status in ('queued', 'active') returning campaign_id`;
  if (first) {
    await db`insert into email_events (workspace_id, campaign_id, recipient_id, type, meta) values (${r.workspace_id}, ${r.campaign_id}, ${r.id}, 'unsubscribe', ${db.json({ via } as never)})`;
    if (r.company_id || r.contact_id) {
      await db`
        insert into activities (workspace_id, company_id, contact_id, type, subject, meta)
        values (${r.workspace_id}, ${r.company_id}, ${r.contact_id}, 'system', ${'Unsubscribed from ' + r.campaign_name}, ${db.json({ campaign_id: r.campaign_id, via } as never)})`;
    }
  }
  for (const id of new Set([r.campaign_id, ...others.map((o) => o.campaign_id)])) await refreshCampaignStats(id).catch(() => undefined);
  return r;
}

export async function recordOpen(token: string, step: number | null) {
  const r = await findRecipient(token);
  if (!r) return;
  const db = sql();
  await db`update campaign_recipients set opened_at = coalesce(opened_at, now()), open_count = open_count + 1 where id = ${r.id}`;
  await db`insert into email_events (workspace_id, campaign_id, recipient_id, type, meta) values (${r.workspace_id}, ${r.campaign_id}, ${r.id}, 'open', ${db.json({ step } as never)})`;
}

export async function recordClick(token: string, url: string, step: number | null): Promise<boolean> {
  const r = await findRecipient(token);
  if (!r) return false;
  const db = sql();
  await db`
    update campaign_recipients set clicked_at = coalesce(clicked_at, now()), click_count = click_count + 1, opened_at = coalesce(opened_at, now())
    where id = ${r.id}`;
  await db`insert into email_events (workspace_id, campaign_id, recipient_id, type, meta) values (${r.workspace_id}, ${r.campaign_id}, ${r.id}, 'click', ${db.json({ step, url } as never)})`;
  return true;
}

/** Self-contained page for public routes (no app shell, works without JS). */
export function publicPage(title: string, body: string, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#f6f6f4;--card:#fff;--text:#16181a;--muted:#6b7075;--line:#e4e4e0;--btn:#16181a;--btn-text:#fff;--accent:#ff7a45}
@media (prefers-color-scheme:dark){:root{--bg:#050607;--card:#101214;--text:#f1f2f3;--muted:#9aa0a6;--line:#23272b;--btn:#f1f2f3;--btn-text:#0b0c0d}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--text);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif}
main{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:32px 28px;box-shadow:0 10px 40px rgba(0,0,0,.08)}
h1{font-size:22px;line-height:1.25;margin:0 0 10px;letter-spacing:-.01em}p{margin:0 0 14px;color:var(--muted)}strong{color:var(--text)}
button{appearance:none;border:0;border-radius:12px;background:var(--btn);color:var(--btn-text);font:600 16px/1 inherit;padding:15px 20px;width:100%;cursor:pointer;margin-top:6px}
.dot{width:10px;height:10px;border-radius:50%;background:var(--accent);display:inline-block;margin-bottom:18px}
small{display:block;margin-top:18px;color:var(--muted);font-size:13px}
</style></head><body><main><span class="dot"></span>${body}</main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
