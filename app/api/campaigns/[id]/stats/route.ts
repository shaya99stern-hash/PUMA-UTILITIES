import { sql } from '@/lib/server/db';
import { requireMember } from '@/lib/server/auth';
import { json, route } from '@/lib/server/http';
import { type IdContext } from '@/lib/email/api';
import { loadCampaign, loadSteps } from '@/lib/email/campaigns';
import { computeCampaignStats } from '@/lib/email/stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Funnel totals, per-step performance, and a 14-day send timeline. */
export const GET = route<IdContext>(async (_request, { params }) => {
  const ctx = await requireMember();
  const { id } = await params;
  const campaign = await loadCampaign(ctx.workspaceId, id);
  const db = sql();
  const [totals, steps, perStep, timeline] = await Promise.all([
    computeCampaignStats(id),
    loadSteps(id),
    db<{ step: number; type: string; n: number }[]>`
      select coalesce((meta->>'step')::int, 0) as step, type, count(distinct recipient_id)::int as n
      from email_events where campaign_id = ${id} and type in ('sent', 'open', 'click', 'reply') group by 1, 2`,
    db<{ day: string; sent: number; opened: number; replied: number }[]>`
      select to_char(date_trunc('day', created_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
        count(*) filter (where type = 'sent')::int as sent, count(*) filter (where type = 'open')::int as opened, count(*) filter (where type = 'reply')::int as replied
      from email_events where campaign_id = ${id} and created_at > now() - interval '14 days' group by 1 order by 1`,
  ]);
  const get = (step: number, type: string) => perStep.find((p) => p.step === step && p.type === type)?.n ?? 0;
  const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
  return json({
    status: campaign.status,
    totals,
    rates: {
      open: rate(totals.opened, totals.contacted),
      click: rate(totals.clicked, totals.contacted),
      reply: rate(totals.replied, totals.contacted),
      bounce: rate(totals.bounced, totals.contacted + totals.bounced),
      unsubscribe: rate(totals.unsubscribed, totals.contacted),
    },
    steps: steps.map((s) => ({
      step: s.position,
      subject: s.subject,
      delayDays: s.delay_days,
      sent: get(s.position, 'sent'),
      opened: get(s.position, 'open'),
      clicked: get(s.position, 'click'),
      replied: get(s.position, 'reply'),
    })),
    timeline,
  });
});
