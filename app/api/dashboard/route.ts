import { requireMember } from '@/lib/server/auth';
import { sql } from '@/lib/server/db';
import { json, route } from '@/lib/server/http';

export const runtime = 'nodejs';

const DEFAULT_TZ = 'America/New_York';

function safeTimezone(value: unknown): string {
  if (typeof value !== 'string' || !value) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return value;
  } catch {
    return DEFAULT_TZ;
  }
}

/** Everything the home dashboard needs in one round trip. */
export const GET = route(async () => {
  const ctx = await requireMember();
  const ws = ctx.workspaceId;
  const db = sql();

  const [workspace] = await db<{ name: string; settings: Record<string, unknown> }[]>`
    select name, settings from workspaces where id = ${ws}`;
  const tz = safeTimezone(workspace?.settings?.timezone);

  let firstName: string | null = null;
  if (ctx.userId) {
    const [p] = await db<{ full_name: string | null }[]>`select full_name from profiles where user_id = ${ctx.userId}`;
    firstName = p?.full_name?.trim().split(/\s+/)[0] ?? null;
  }

  // Day boundaries in the workspace time zone.
  const [bounds] = await db<{ start_today: Date; end_today: Date }[]>`
    select (date_trunc('day', now() at time zone ${tz}) at time zone ${tz}) as start_today,
           ((date_trunc('day', now() at time zone ${tz}) + interval '1 day') at time zone ${tz}) as end_today`;
  const { start_today: startToday, end_today: endToday } = bounds;

  const [kpis, stageRows, tasks, followUps, activity, jobs, campaigns, setup] = await Promise.all([
    db<
      {
        pipeline: number;
        qualified: number;
        clients: number;
        tasks_today: number;
        tasks_overdue: number;
        sent_7d: number;
        sent_prev_7d: number;
        replies_30d: number;
        sent_30d: number;
        new_companies_7d: number;
      }[]
    >`
      select
        (select count(*)::int from companies where workspace_id = ${ws} and stage not in ('client', 'lost')) as pipeline,
        (select count(*)::int from companies where workspace_id = ${ws} and stage = 'qualified') as qualified,
        (select count(*)::int from companies where workspace_id = ${ws} and stage = 'client') as clients,
        (select count(*)::int from companies where workspace_id = ${ws} and created_at > now() - interval '7 days') as new_companies_7d,
        (select count(*)::int from tasks where workspace_id = ${ws} and status = 'open' and due_at >= ${startToday} and due_at < ${endToday}) as tasks_today,
        (select count(*)::int from tasks where workspace_id = ${ws} and status = 'open' and due_at < ${startToday}) as tasks_overdue,
        greatest(
          (select count(*)::int from email_messages where workspace_id = ${ws} and direction = 'out' and sent_at > now() - interval '7 days'),
          (select count(*)::int from email_events where workspace_id = ${ws} and type = 'sent' and created_at > now() - interval '7 days')
        ) as sent_7d,
        greatest(
          (select count(*)::int from email_messages where workspace_id = ${ws} and direction = 'out' and sent_at > now() - interval '14 days' and sent_at <= now() - interval '7 days'),
          (select count(*)::int from email_events where workspace_id = ${ws} and type = 'sent' and created_at > now() - interval '14 days' and created_at <= now() - interval '7 days')
        ) as sent_prev_7d,
        (select count(*)::int from campaign_recipients where workspace_id = ${ws} and replied_at > now() - interval '30 days') as replies_30d,
        (select count(*)::int from campaign_recipients where workspace_id = ${ws} and last_sent_at > now() - interval '30 days') as sent_30d`,
    db<{ stage: string; count: number; value: number | null }[]>`
      select stage, count(*)::int as count, sum(est_annual_water_spend)::float8 as value
      from companies where workspace_id = ${ws} group by stage`,
    db<
      {
        id: string;
        title: string;
        type: string;
        priority: string;
        due_at: string | null;
        company_id: string | null;
        company_name: string | null;
      }[]
    >`
      select t.id, t.title, t.type, t.priority, t.due_at, t.company_id, c.name as company_name
      from tasks t left join companies c on c.id = t.company_id
      where t.workspace_id = ${ws} and t.status = 'open' and t.due_at < ${endToday}
      order by t.due_at asc, t.priority = 'high' desc
      limit 12`,
    db<{ id: string; name: string; stage: string; next_follow_up_at: string; city: string | null; state: string | null }[]>`
      select id, name, stage, next_follow_up_at, city, state from companies
      where workspace_id = ${ws} and next_follow_up_at < ${endToday} and stage <> 'lost'
      order by next_follow_up_at asc limit 10`,
    db<
      {
        id: string;
        type: string;
        subject: string | null;
        body: string | null;
        occurred_at: string;
        company_id: string | null;
        company_name: string | null;
        contact_name: string | null;
      }[]
    >`
      select a.id, a.type, a.subject, left(a.body, 240) as body, a.occurred_at, a.company_id,
             c.name as company_name, ct.full_name as contact_name
      from activities a
      left join companies c on c.id = a.company_id
      left join contacts ct on ct.id = a.contact_id
      where a.workspace_id = ${ws}
      order by a.occurred_at desc limit 10`,
    db<
      {
        id: string;
        kind: string;
        title: string;
        status: string;
        progress: number;
        stage: string | null;
        created_at: string;
        finished_at: string | null;
        error: string | null;
        candidates: number;
      }[]
    >`
      select j.id, j.kind, j.title, j.status, j.progress, j.stage, j.created_at, j.finished_at, j.error,
             (select count(*)::int from lead_candidates lc where lc.job_id = j.id) as candidates
      from research_jobs j where j.workspace_id = ${ws}
      order by j.created_at desc limit 5`,
    db<
      {
        id: string;
        name: string;
        status: string;
        created_at: string;
        recipients: number;
        sent: number;
        opened: number;
        replied: number;
        bounced: number;
      }[]
    >`
      select c.id, c.name, c.status, c.created_at,
             count(r.id)::int as recipients,
             count(r.last_sent_at)::int as sent,
             count(r.opened_at)::int as opened,
             count(r.replied_at)::int as replied,
             count(r.bounced_at)::int as bounced
      from campaigns c left join campaign_recipients r on r.campaign_id = c.id
      where c.workspace_id = ${ws}
      group by c.id
      order by (c.status in ('sending', 'scheduled')) desc, c.created_at desc
      limit 4`,
    db<{ companies: number; contacts: number; mailboxes: number; jobs: number }[]>`
      select
        (select count(*)::int from companies where workspace_id = ${ws}) as companies,
        (select count(*)::int from contacts where workspace_id = ${ws}) as contacts,
        (select count(*)::int from mailboxes where workspace_id = ${ws} and status <> 'disconnected') as mailboxes,
        (select count(*)::int from research_jobs where workspace_id = ${ws}) as jobs`,
  ]);

  const k = kpis[0];
  return json({
    workspaceName: workspace?.name ?? 'Puma Utilities',
    firstName,
    timezone: tz,
    now: new Date().toISOString(),
    kpis: {
      pipeline: k.pipeline,
      qualified: k.qualified,
      clients: k.clients,
      newCompanies7d: k.new_companies_7d,
      tasksToday: k.tasks_today,
      tasksOverdue: k.tasks_overdue,
      sent7d: k.sent_7d,
      sentPrev7d: k.sent_prev_7d,
      replyRate: k.sent_30d > 0 ? k.replies_30d / k.sent_30d : null,
      replies30d: k.replies_30d,
      sent30d: k.sent_30d,
    },
    stages: stageRows,
    tasks,
    followUps,
    activity,
    jobs,
    campaigns,
    setup: setup[0],
  });
});
