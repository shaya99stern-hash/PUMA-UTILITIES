import 'server-only';
import { sql } from '@/lib/server/db';
import { ApiError } from '@/lib/server/http';
import { baseUrlFrom, ComplianceError, MISSING_ADDRESS_WARNING, normalizeCompanyAddress } from './compliance';
import { isAuthFailure, isPermanentRecipientFailure } from './providers/shared';
import { loadMailbox, sendViaMailbox, senderOf, sentLast24h, type MailboxRow } from './mailboxes';
import { SAMPLE_RECIPIENT, sanitizeEmailHtml, snippetOf, type MergeSource } from './merge';
import { cleanMessageId, threadKeyFor } from './reply';
import { renderEmail, stripReplyPrefix, type Rendered } from './render';
import { computeFollowUpAt, isWithinWindow, localDayKey, planSchedule, zonedParts, zonedTimeToUtc, computeNextSendAt } from './schedule';
import { normalizeSettings, type CampaignSettings } from './settings';
import { refreshCampaignStats } from './stats';
import { followUpHeaders } from './threading';
import { loadWorkspaceEmail, type WorkspaceEmail } from './workspace';

export type CampaignRow = {
  id: string;
  workspace_id: string;
  mailbox_id: string | null;
  name: string;
  status: 'draft' | 'scheduled' | 'sending' | 'paused' | 'completed' | 'canceled';
  settings: Record<string, unknown>;
  stats: Record<string, unknown>;
  scheduled_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type StepRow = { id: string; campaign_id: string; position: number; delay_days: number; subject: string; body_html: string };

export type RecipientRow = {
  id: string;
  workspace_id: string;
  campaign_id: string;
  contact_id: string | null;
  company_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  merge: Record<string, unknown>;
  token: string;
  status: string;
  current_step: number;
  next_send_at: Date | null;
  last_sent_at: Date | null;
  thread_key: string | null;
};

export type ReadinessIssue = { level: 'error' | 'warning'; message: string };

export async function loadCampaign(workspaceId: string, id: string): Promise<CampaignRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, 'Campaign not found.');
  const rows = await sql()<CampaignRow[]>`select * from campaigns where id = ${id} and workspace_id = ${workspaceId}`;
  if (!rows[0]) throw new ApiError(404, 'Campaign not found.');
  return rows[0];
}

export async function loadSteps(campaignId: string): Promise<StepRow[]> {
  return sql()<StepRow[]>`select id, campaign_id, position, delay_days, subject, body_html from campaign_steps where campaign_id = ${campaignId} order by position`;
}

export function settingsFor(campaign: Pick<CampaignRow, 'settings'>, mailbox: Pick<MailboxRow, 'daily_limit'> | null, defaults?: Partial<CampaignSettings>): CampaignSettings {
  return normalizeSettings(campaign.settings, { mailboxDailyLimit: mailbox?.daily_limit, base: defaults });
}

export type StepInput = { subject: string; bodyHtml: string; delayDays: number };

export async function replaceSteps(campaignId: string, steps: StepInput[]) {
  const db = sql();
  await db.begin(async (tx) => {
    await tx`delete from campaign_steps where campaign_id = ${campaignId}`;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      await tx`
        insert into campaign_steps (campaign_id, position, delay_days, subject, body_html)
        values (${campaignId}, ${i}, ${i === 0 ? 0 : Math.max(0, s.delayDays)}, ${s.subject.trim()}, ${sanitizeEmailHtml(s.bodyHtml)})`;
    }
  });
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export async function readiness(campaign: CampaignRow, baseUrl: string): Promise<{ issues: ReadinessIssue[]; workspace: WorkspaceEmail; mailbox: MailboxRow | null }> {
  const issues: ReadinessIssue[] = [];
  const workspace = await loadWorkspaceEmail(campaign.workspace_id);
  let mailbox: MailboxRow | null = null;
  if (!campaign.mailbox_id) issues.push({ level: 'error', message: 'Choose the email account this campaign sends from.' });
  else {
    mailbox = await loadMailbox(campaign.workspace_id, campaign.mailbox_id).catch(() => null);
    if (!mailbox) issues.push({ level: 'error', message: 'The selected email account no longer exists.' });
    else if (mailbox.status !== 'active') issues.push({ level: 'error', message: `Reconnect ${mailbox.email}: ${mailbox.last_error ?? 'the connection is not active.'}` });
  }
  if (!normalizeCompanyAddress(workspace.companyAddress)) issues.push({ level: 'warning', message: MISSING_ADDRESS_WARNING });
  const steps = await loadSteps(campaign.id);
  if (!steps.length) issues.push({ level: 'error', message: 'Add at least one email to the sequence.' });
  if (steps[0] && !steps[0].subject.trim()) issues.push({ level: 'error', message: 'The first email needs a subject line.' });
  steps.forEach((s, i) => {
    if (!s.body_html.replace(/<[^>]+>/g, '').trim()) issues.push({ level: 'error', message: `Email ${i + 1} has no body.` });
  });
  const counts = await sql()<{ queued: number; total: number }[]>`
    select count(*) filter (where status in ('queued', 'active'))::int as queued, count(*)::int as total from campaign_recipients where campaign_id = ${campaign.id}`;
  if (!counts[0]?.total) issues.push({ level: 'error', message: 'Add at least one recipient.' });
  if (process.env.NODE_ENV === 'production' && /localhost|127\.0\.0\.1/.test(baseUrl)) {
    issues.push({ level: 'error', message: 'Set NEXT_PUBLIC_APP_URL to your public address so unsubscribe links work.' });
  }
  const settings = settingsFor(campaign, mailbox, workspace.defaults);
  if (mailbox && Number(campaign.settings.dailyLimit ?? 0) > mailbox.daily_limit) {
    issues.push({ level: 'warning', message: `Daily limit is capped at ${mailbox.daily_limit} by ${mailbox.email}.` });
  }
  if (settings.trackClicks) issues.push({ level: 'warning', message: 'Click tracking rewrites links, which can reduce inbox placement on new sending domains.' });
  return { issues, workspace, mailbox };
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

async function sentTodayForCampaign(campaignId: string, tz: string, at = new Date()): Promise<number> {
  const p = zonedParts(at, tz);
  const start = zonedTimeToUtc(p.year, p.month, p.day, 0, 0, tz);
  const rows = await sql()<{ n: number }[]>`select count(*)::int as n from email_events where campaign_id = ${campaignId} and type = 'sent' and created_at >= ${start}`;
  return rows[0]?.n ?? 0;
}

/** Spaces the given recipients (in order) starting at `start`, honoring windows and the daily cap. */
export async function assignSchedule(campaign: CampaignRow, settings: CampaignSettings, recipientIds: string[], start: Date) {
  if (!recipientIds.length) return;
  const sentToday = await sentTodayForCampaign(campaign.id, settings.timezone, start);
  const times = planSchedule(recipientIds.length, start, settings, { sentToday });
  for (let i = 0; i < recipientIds.length; i += 1000) {
    const ids = recipientIds.slice(i, i + 1000);
    const ts = times.slice(i, i + 1000).map((t) => t.toISOString());
    await sql()`
      update campaign_recipients r set next_send_at = v.t
      from (select * from unnest(${ids}::uuid[], ${ts}::timestamptz[]) as x(id, t)) v
      where r.id = v.id`;
  }
}

/** Schedules recipients that are waiting with no send time (new or overdue after a pause). */
export async function scheduleWaiting(campaign: CampaignRow, settings: CampaignSettings, opts: { startAt?: Date; includeOverdue?: boolean } = {}) {
  const db = sql();
  const now = new Date();
  const ids = await db<{ id: string }[]>`
    select id from campaign_recipients
    where campaign_id = ${campaign.id} and status in ('queued', 'active')
      and current_step = 0 and (next_send_at is null ${opts.includeOverdue ? db`or next_send_at < ${now}` : db``})
    order by coalesce(next_send_at, created_at), created_at`;
  // Start after whatever is already queued so late additions do not jump the line.
  const tail = await db<{ t: Date | null }[]>`
    select max(next_send_at) as t from campaign_recipients
    where campaign_id = ${campaign.id} and status in ('queued', 'active') and current_step = 0 and next_send_at > ${now}`;
  const base = opts.startAt && opts.startAt > now ? opts.startAt : now;
  const start = tail[0]?.t && tail[0].t > base && !opts.startAt ? tail[0].t : base;
  await assignSchedule(campaign, settings, ids.map((r) => r.id), start);
  return ids.length;
}

/** Follow-ups that came due while paused are pushed into the next window, preserving order. */
async function rescheduleOverdueFollowUps(campaign: CampaignRow, settings: CampaignSettings) {
  const db = sql();
  const rows = await db<{ id: string }[]>`
    select id from campaign_recipients where campaign_id = ${campaign.id} and status = 'active' and current_step > 0 and next_send_at < now() order by next_send_at`;
  await assignSchedule(campaign, settings, rows.map((r) => r.id), new Date());
}

export async function launchCampaign(workspaceId: string, campaignId: string, baseUrl: string, opts: { startAt?: Date } = {}) {
  const campaign = await loadCampaign(workspaceId, campaignId);
  if (!['draft', 'paused', 'scheduled'].includes(campaign.status)) throw new ApiError(409, `This campaign is already ${campaign.status}.`);
  const { issues, workspace, mailbox } = await readiness(campaign, baseUrl);
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length) throw new ApiError(400, errors[0].message, { issues });
  const settings = settingsFor(campaign, mailbox, workspace.defaults);
  await sql()`update campaigns set settings = ${sql().json(settings as never)} where id = ${campaign.id}`;
  await scheduleWaiting(campaign, settings, { startAt: opts.startAt, includeOverdue: true });
  await sql()`
    update campaigns set status = 'sending', started_at = coalesce(started_at, now()), scheduled_at = ${opts.startAt ?? null}, completed_at = null,
      stats = coalesce(stats, '{}'::jsonb) - 'lastError'
    where id = ${campaign.id}`;
  await refreshCampaignStats(campaign.id);
  return { ok: true, issues };
}

export async function pauseCampaign(workspaceId: string, campaignId: string) {
  const campaign = await loadCampaign(workspaceId, campaignId);
  if (!['sending', 'scheduled'].includes(campaign.status)) throw new ApiError(409, 'Only a running campaign can be paused.');
  await sql()`update campaigns set status = 'paused' where id = ${campaign.id}`;
  return { ok: true };
}

export async function resumeCampaign(workspaceId: string, campaignId: string, baseUrl: string) {
  const campaign = await loadCampaign(workspaceId, campaignId);
  if (campaign.status !== 'paused') throw new ApiError(409, 'Only a paused campaign can be resumed.');
  const { issues, workspace, mailbox } = await readiness(campaign, baseUrl);
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length) throw new ApiError(400, errors[0].message, { issues });
  const settings = settingsFor(campaign, mailbox, workspace.defaults);
  await scheduleWaiting(campaign, settings, { includeOverdue: true });
  await rescheduleOverdueFollowUps(campaign, settings);
  await sql()`update campaigns set status = 'sending', stats = coalesce(stats, '{}'::jsonb) - 'lastError' where id = ${campaign.id}`;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Preview and test sends
// ---------------------------------------------------------------------------

export type PreviewArgs = {
  workspaceId: string;
  steps: { subject: string; body_html: string }[];
  stepIndex: number;
  settings: CampaignSettings;
  mailbox: MailboxRow | null;
  recipient: MergeSource;
  origin: string;
  requireAddress?: boolean;
};

export async function renderPreview(args: PreviewArgs): Promise<Rendered & { address: string | null }> {
  const workspace = await loadWorkspaceEmail(args.workspaceId);
  const step = args.steps[args.stepIndex] ?? args.steps[0] ?? { subject: '', body_html: '' };
  let first: string | null = null;
  if (args.stepIndex > 0 && args.steps[0]) {
    first = renderEmail({
      step: args.steps[0],
      stepIndex: 0,
      recipient: args.recipient,
      token: 'preview',
      sender: { name: args.mailbox?.display_name, email: args.mailbox?.email ?? 'you@example.com' },
      signatureHtml: null,
      settings: args.settings,
      workspace: { address: workspace.companyAddress ?? '', companyName: workspace.companyName },
      baseUrl: baseUrlFrom(args.origin),
      preview: true,
    }).subject;
  }
  const rendered = renderEmail({
    step,
    stepIndex: args.stepIndex,
    firstSubject: first,
    recipient: args.recipient,
    token: 'preview',
    sender: { name: args.mailbox?.display_name, email: args.mailbox?.email ?? 'you@example.com' },
    signatureHtml: args.mailbox?.signature_html,
    settings: args.settings,
    workspace: { address: workspace.companyAddress ?? '', companyName: workspace.companyName },
    baseUrl: baseUrlFrom(args.origin),
    preview: true,
  });
  return { ...rendered, address: workspace.companyAddress };
}

export async function sampleRecipient(workspaceId: string, opts: { campaignId?: string; recipientId?: string; contactId?: string }): Promise<MergeSource> {
  const db = sql();
  if (opts.recipientId) {
    const r = await db<{ email: string; first_name: string | null; last_name: string | null; company_name: string | null; merge: Record<string, unknown> }[]>`
      select email::text as email, first_name, last_name, company_name, merge from campaign_recipients where id = ${opts.recipientId} and workspace_id = ${workspaceId}`;
    if (r[0]) return { ...(r[0].merge as MergeSource), email: r[0].email, first_name: r[0].first_name, last_name: r[0].last_name, company_name: r[0].company_name };
  }
  if (opts.contactId) {
    const r = await db<{ email: string | null; first_name: string | null; last_name: string | null; full_name: string; title: string | null; name: string | null; city: string | null; state: string | null; portfolio_units: number | null }[]>`
      select c.email::text as email, c.first_name, c.last_name, c.full_name, c.title, co.name, co.city, co.state, co.portfolio_units
      from contacts c left join companies co on co.id = c.company_id where c.id = ${opts.contactId} and c.workspace_id = ${workspaceId}`;
    if (r[0]) return { email: r[0].email, first_name: r[0].first_name, last_name: r[0].last_name, full_name: r[0].full_name, title: r[0].title, company_name: r[0].name, city: r[0].city, state: r[0].state, portfolio_units: r[0].portfolio_units };
  }
  if (opts.campaignId) {
    const r = await db<{ id: string }[]>`select id from campaign_recipients where campaign_id = ${opts.campaignId} and workspace_id = ${workspaceId} order by created_at limit 1`;
    if (r[0]) return sampleRecipient(workspaceId, { recipientId: r[0].id });
  }
  return SAMPLE_RECIPIENT;
}

export async function sendTestEmail(args: PreviewArgs & { to: string }) {
  if (!args.mailbox) throw new ApiError(400, 'Choose a sending account first.');
  const rendered = await renderPreview(args);
  const result = await sendViaMailbox(args.mailbox, {
    from: senderOf(args.mailbox),
    to: [args.to],
    subject: `[Test] ${rendered.subject || '(no subject)'}`,
    html: rendered.html,
    text: rendered.text,
    headers: { 'X-Puma-Test': '1' },
  });
  return { messageId: result.messageId, to: args.to, subject: `[Test] ${rendered.subject}` };
}

// ---------------------------------------------------------------------------
// The sender
// ---------------------------------------------------------------------------

export type TickSummary = {
  claimed: number;
  sent: number;
  skipped: number;
  deferred: number;
  failed: number;
  bounced: number;
  completedCampaigns: number;
  pausedCampaigns: number;
  errors: string[];
  durationMs: number;
};

type CampaignCtx = {
  campaign: CampaignRow;
  settings: CampaignSettings;
  steps: StepRow[];
  mailbox: MailboxRow | null;
  workspace: WorkspaceEmail;
  campaignSentToday: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadCtx(row: CampaignRow): Promise<CampaignCtx> {
  const mailbox = row.mailbox_id ? await loadMailbox(row.workspace_id, row.mailbox_id).catch(() => null) : null;
  const workspace = await loadWorkspaceEmail(row.workspace_id);
  const settings = settingsFor(row, mailbox, workspace.defaults);
  return { campaign: row, settings, steps: await loadSteps(row.id), mailbox, workspace, campaignSentToday: await sentTodayForCampaign(row.id, settings.timezone) };
}

function startOfNextLocalDay(tz: string, at = new Date()): Date {
  const p = zonedParts(at, tz);
  return zonedTimeToUtc(p.year, p.month, p.day + 1, 0, 1, tz);
}

export async function runEmailTick(opts: { budgetMs?: number; baseUrl?: string; maxPerTick?: number } = {}): Promise<TickSummary> {
  const started = Date.now();
  const deadline = started + (opts.budgetMs ?? 20_000);
  const baseUrl = baseUrlFrom(opts.baseUrl);
  const db = sql();
  const summary: TickSummary = { claimed: 0, sent: 0, skipped: 0, deferred: 0, failed: 0, bounced: 0, completedCampaigns: 0, pausedCampaigns: 0, errors: [], durationMs: 0 };

  // Claim with a lease: SKIP LOCKED lets overlapping ticks work on different rows, and the pushed-out
  // next_send_at means a crashed worker's rows come back after the lease expires.
  const claimed = await db<RecipientRow[]>`
    with due as (
      select r.id from campaign_recipients r join campaigns c on c.id = r.campaign_id
      where c.status = 'sending' and r.status in ('queued', 'active') and r.next_send_at <= now()
      order by r.next_send_at
      limit ${opts.maxPerTick ?? 30}
      for update of r skip locked
    )
    update campaign_recipients r set next_send_at = now() + interval '10 minutes'
    from due where r.id = due.id
    returning r.id, r.workspace_id, r.campaign_id, r.contact_id, r.company_id, r.email::text as email, r.first_name, r.last_name, r.company_name,
      r.merge, r.token, r.status, r.current_step, r.next_send_at, r.last_sent_at, r.thread_key`;
  summary.claimed = claimed.length;
  claimed.sort((a, b) => a.campaign_id.localeCompare(b.campaign_id));

  const ctxCache = new Map<string, CampaignCtx>();
  const mailboxSent = new Map<string, number>();
  const mailboxLastSend = new Map<string, number>();
  const blockedMailboxes = new Set<string>();
  const touched = new Set<string>();
  const pausedNow = new Set<string>();
  const limitReached = new Set<string>();

  const release = (id: string, at: Date) => db`update campaign_recipients set next_send_at = ${at} where id = ${id}`;

  for (let idx = 0; idx < claimed.length; idx++) {
    const r = claimed[idx];
    if (Date.now() > deadline - 2500) {
      // Out of budget: hand the rest back immediately.
      await db`update campaign_recipients set next_send_at = now() where id = any(${claimed.slice(idx).map((c) => c.id)}::uuid[])`;
      break;
    }
    try {
      let ctx = ctxCache.get(r.campaign_id);
      if (!ctx) {
        const rows = await db<CampaignRow[]>`select * from campaigns where id = ${r.campaign_id}`;
        if (!rows[0]) continue;
        ctx = await loadCtx(rows[0]);
        ctxCache.set(r.campaign_id, ctx);
      }
      if (limitReached.has(r.campaign_id)) continue; // already rescheduled for the next day
      if (pausedNow.has(r.campaign_id) || ctx.campaign.status !== 'sending') {
        await release(r.id, new Date());
        continue;
      }
      const { settings, mailbox } = ctx;
      touched.add(r.campaign_id);

      if (!mailbox || mailbox.status !== 'active') {
        await db`update campaigns set status = 'paused', stats = coalesce(stats, '{}'::jsonb) || ${db.json({ lastError: mailbox ? `${mailbox.email} needs to be reconnected.` : 'The sending account was removed.' } as never)} where id = ${r.campaign_id}`;
        pausedNow.add(r.campaign_id);
        summary.pausedCampaigns += 1;
        await release(r.id, new Date());
        continue;
      }
      if (blockedMailboxes.has(mailbox.id)) {
        await release(r.id, new Date(Date.now() + 30 * 60_000));
        summary.deferred += 1;
        continue;
      }

      // Suppression and contact flags are re-checked at send time.
      const blocked = await db<{ reason: string | null; unsub: Date | null; bounced: Date | null }[]>`
        select (select reason from suppressions where workspace_id = ${r.workspace_id} and email = ${r.email}) as reason,
               (select unsubscribed_at from contacts where id = ${r.contact_id}) as unsub,
               (select bounced_at from contacts where id = ${r.contact_id}) as bounced`;
      const b = blocked[0];
      if (b?.reason || b?.unsub || b?.bounced) {
        const status = b.reason === 'bounced' || b.bounced ? 'bounced' : b.reason === 'unsubscribed' || b.unsub ? 'unsubscribed' : 'skipped';
        await db`update campaign_recipients set status = ${status}, next_send_at = null, error = ${'Suppressed: ' + (b.reason ?? status)} where id = ${r.id}`;
        summary.skipped += 1;
        continue;
      }

      if (!isWithinWindow(new Date(), settings)) {
        await release(r.id, computeNextSendAt(new Date(), settings));
        summary.deferred += 1;
        continue;
      }

      // Daily limits: per campaign (local day) and per mailbox (rolling 24h).
      if (ctx.campaignSentToday >= settings.dailyLimit) {
        const pending = await db<{ id: string }[]>`
          select id from campaign_recipients where campaign_id = ${r.campaign_id} and status in ('queued', 'active') and next_send_at <= now() + interval '10 minutes' order by next_send_at limit 5000`;
        await assignSchedule(ctx.campaign, settings, pending.map((p) => p.id), startOfNextLocalDay(settings.timezone));
        summary.deferred += pending.length;
        limitReached.add(r.campaign_id);
        continue;
      }
      if (!mailboxSent.has(mailbox.id)) mailboxSent.set(mailbox.id, await sentLast24h(mailbox.id));
      if ((mailboxSent.get(mailbox.id) ?? 0) >= mailbox.daily_limit) {
        blockedMailboxes.add(mailbox.id);
        await release(r.id, new Date(Date.now() + 30 * 60_000));
        summary.deferred += 1;
        continue;
      }

      const step = ctx.steps[r.current_step];
      if (!step) {
        await db`update campaign_recipients set status = 'completed', next_send_at = null where id = ${r.id}`;
        continue;
      }

      const address = normalizeCompanyAddress(ctx.workspace.companyAddress) ?? '';

      // Follow-ups reply in the same thread.
      let inReplyTo: string | null = null;
      let references: string[] = [];
      let firstSubject: string | null = null;
      if (r.current_step > 0) {
        const prior = await db<{ message_id_header: string | null; subject: string | null }[]>`
          select message_id_header, subject from email_messages where recipient_id = ${r.id} and direction = 'out' order by sent_at`;
        const fu = followUpHeaders(prior.map((p) => p.message_id_header).filter(Boolean) as string[]);
        inReplyTo = fu.inReplyTo;
        references = fu.references;
        firstSubject = prior[0]?.subject ?? null;
      }

      const recipientSource: MergeSource = { ...(r.merge as MergeSource), email: r.email, first_name: r.first_name, last_name: r.last_name, company_name: r.company_name };
      const rendered = renderEmail({
        step,
        stepIndex: r.current_step,
        firstSubject,
        recipient: recipientSource,
        token: r.token,
        sender: senderOf(mailbox),
        signatureHtml: mailbox.signature_html,
        settings,
        workspace: { address, companyName: ctx.workspace.companyName },
        baseUrl,
      });
      if (!rendered.subject) {
        await db`update campaign_recipients set status = 'failed', next_send_at = null, error = 'Empty subject line' where id = ${r.id}`;
        summary.failed += 1;
        continue;
      }

      // Gentle pacing when several messages go out from one mailbox in a single tick.
      const last = mailboxLastSend.get(mailbox.id);
      if (last) await sleep(Math.max(0, Math.min(1500, 600 + Math.random() * 900 - (Date.now() - last))));

      let sent;
      try {
        sent = await sendViaMailbox(mailbox, {
          from: senderOf(mailbox),
          to: [r.email],
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          headers: rendered.headers,
          inReplyTo,
          references,
        });
      } catch (error) {
        const cause = (error as { cause?: unknown }).cause ?? error;
        const message = error instanceof Error ? error.message : 'Send failed';
        if (isPermanentRecipientFailure(cause)) {
          await db`update campaign_recipients set status = 'bounced', bounced_at = now(), next_send_at = null, error = ${message.slice(0, 300)} where id = ${r.id}`;
          await db`insert into suppressions (workspace_id, email, reason) values (${r.workspace_id}, ${r.email}, 'bounced') on conflict do nothing`;
          if (r.contact_id) await db`update contacts set bounced_at = now(), email_status = 'bounced' where id = ${r.contact_id}`;
          await db`insert into email_events (workspace_id, campaign_id, recipient_id, type, meta) values (${r.workspace_id}, ${r.campaign_id}, ${r.id}, 'bounce', ${db.json({ at_send: true, permanent: true, reason: message.slice(0, 300) } as never)})`;
          summary.bounced += 1;
          continue;
        }
        if (isAuthFailure(cause) || isAuthFailure(error)) {
          await db`update campaigns set status = 'paused', stats = coalesce(stats, '{}'::jsonb) || ${db.json({ lastError: message } as never)} where id = ${r.campaign_id}`;
          pausedNow.add(r.campaign_id);
          summary.pausedCampaigns += 1;
          await release(r.id, new Date(Date.now() + 60_000));
          summary.errors.push(message);
          continue;
        }
        const errs = await db<{ n: number }[]>`select count(*)::int as n from email_events where recipient_id = ${r.id} and type = 'error'`;
        const attempts = (errs[0]?.n ?? 0) + 1;
        await db`insert into email_events (workspace_id, campaign_id, recipient_id, type, meta) values (${r.workspace_id}, ${r.campaign_id}, ${r.id}, 'error', ${db.json({ message: message.slice(0, 300), attempt: attempts } as never)})`;
        if (/limit|quota|too many|rate/i.test(message)) blockedMailboxes.add(mailbox.id);
        if (attempts >= 3) {
          await db`update campaign_recipients set status = 'failed', next_send_at = null, error = ${message.slice(0, 300)} where id = ${r.id}`;
          summary.failed += 1;
        } else {
          await release(r.id, new Date(Date.now() + 5 * 60_000 * 2 ** (attempts - 1)));
          summary.deferred += 1;
        }
        summary.errors.push(message);
        continue;
      }

      mailboxLastSend.set(mailbox.id, Date.now());
      mailboxSent.set(mailbox.id, (mailboxSent.get(mailbox.id) ?? 0) + 1);
      ctx.campaignSentToday += 1;
      const now = new Date();
      const messageIdHeader = cleanMessageId(sent.messageId) ?? sent.messageId;
      const threadKey = r.thread_key ?? threadKeyFor({ messageId: messageIdHeader, references, inReplyTo });
      const nextStep = ctx.steps[r.current_step + 1];
      const isLast = !nextStep;

      const stored = await db<{ id: string }[]>`
        insert into email_messages (
          workspace_id, mailbox_id, direction, provider_id, message_id_header, thread_key, in_reply_to, references_header, from_email, from_name,
          to_emails, subject, snippet, body_text, body_html, sent_at, is_read, contact_id, company_id, campaign_id, recipient_id
        ) values (
          ${r.workspace_id}, ${mailbox.id}, 'out', ${sent.providerId}, ${messageIdHeader}, ${threadKey}, ${inReplyTo}, ${references.join(' ') || null}, ${mailbox.email}, ${mailbox.display_name},
          ${db.array([r.email], 25)}, ${rendered.subject}, ${snippetOf(rendered.text)}, ${rendered.text}, ${rendered.html}, ${now}, true, ${r.contact_id}, ${r.company_id}, ${r.campaign_id}, ${r.id}
        ) on conflict (mailbox_id, provider_id) do nothing returning id`;

      await db`
        update campaign_recipients set
          status = ${isLast ? 'completed' : 'active'},
          current_step = ${r.current_step + 1},
          last_sent_at = ${now},
          next_send_at = ${isLast ? null : computeFollowUpAt(now, nextStep.delay_days, settings)},
          last_message_id = ${messageIdHeader},
          thread_key = ${threadKey},
          error = null
        where id = ${r.id} and status in ('queued', 'active')`;
      await db`
        insert into email_events (workspace_id, campaign_id, recipient_id, type, meta)
        values (${r.workspace_id}, ${r.campaign_id}, ${r.id}, 'sent', ${db.json({ step: r.current_step, mailbox_id: mailbox.id, message_id: messageIdHeader, subject: rendered.subject } as never)})`;
      if (r.company_id || r.contact_id) {
        await db`
          insert into activities (workspace_id, company_id, contact_id, type, subject, body, meta, occurred_at)
          values (${r.workspace_id}, ${r.company_id}, ${r.contact_id}, 'email_out', ${rendered.subject}, ${snippetOf(rendered.text, 400)},
                  ${db.json({ campaign_id: r.campaign_id, campaign: ctx.campaign.name, step: r.current_step + 1, message_id: stored[0]?.id ?? null, mailbox_id: mailbox.id } as never)}, ${now})`;
      }
      if (r.company_id) await db`update companies set last_contacted_at = ${now}, last_activity_at = ${now} where id = ${r.company_id}`;
      if (r.contact_id) await db`update contacts set last_contacted_at = ${now} where id = ${r.contact_id}`;
      summary.sent += 1;
    } catch (error) {
      const message = error instanceof ComplianceError || error instanceof Error ? error.message : 'Unexpected error';
      summary.errors.push(message);
      if (error instanceof ComplianceError) {
        await db`update campaigns set status = 'paused', stats = coalesce(stats, '{}'::jsonb) || ${db.json({ lastError: message } as never)} where id = ${r.campaign_id}`;
        pausedNow.add(r.campaign_id);
        summary.pausedCampaigns += 1;
      }
      await release(r.id, new Date(Date.now() + 10 * 60_000)).catch(() => undefined);
    }
  }

  // Finish campaigns with nothing left to send.
  const done = await db<{ id: string }[]>`
    update campaigns c set status = 'completed', completed_at = now()
    where c.status = 'sending' and c.started_at is not null
      and not exists (select 1 from campaign_recipients r where r.campaign_id = c.id and r.status in ('queued', 'active'))
    returning c.id`;
  summary.completedCampaigns = done.length;
  for (const d of done) touched.add(d.id);
  for (const id of touched) await refreshCampaignStats(id).catch(() => undefined);

  summary.durationMs = Date.now() - started;
  return summary;
}

export { stripReplyPrefix, localDayKey };
