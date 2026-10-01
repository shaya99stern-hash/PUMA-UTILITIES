'use client';

import {
  ArrowRight,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleDot,
  FileUp,
  Mail,
  MailOpen,
  MessageSquareReply,
  Mic,
  NotebookPen,
  Phone,
  Plus,
  Send,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  ProgressBar,
  Skeleton,
  StageBadge,
  Stat,
  STAGES,
  Timeline,
  formatNumber,
  formatRelative,
  useToast,
  type BadgeTone,
  type TimelineItem,
} from '@/app/ui';
import { apiPatch, useApi } from '@/lib/client/api';

type Dashboard = {
  workspaceName: string;
  firstName: string | null;
  timezone: string;
  kpis: {
    pipeline: number;
    qualified: number;
    clients: number;
    newCompanies7d: number;
    tasksToday: number;
    tasksOverdue: number;
    sent7d: number;
    sentPrev7d: number;
    replyRate: number | null;
    replies30d: number;
    sent30d: number;
  };
  stages: { stage: string; count: number; value: number | null }[];
  tasks: { id: string; title: string; type: string; priority: string; due_at: string | null; company_id: string | null; company_name: string | null }[];
  followUps: { id: string; name: string; stage: string; next_follow_up_at: string; city: string | null; state: string | null }[];
  activity: {
    id: string;
    type: string;
    subject: string | null;
    body: string | null;
    occurred_at: string;
    company_id: string | null;
    company_name: string | null;
    contact_name: string | null;
  }[];
  jobs: {
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
  }[];
  campaigns: { id: string; name: string; status: string; created_at: string; recipients: number; sent: number; opened: number; replied: number; bounced: number }[];
  setup: { companies: number; contacts: number; mailboxes: number; jobs: number };
};

function greeting(date: Date) {
  const h = date.getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const ACTIVITY_ICON: Record<string, { icon: LucideIcon; tone?: TimelineItem['tone'] }> = {
  note: { icon: NotebookPen },
  voice_note: { icon: Mic },
  call: { icon: Phone, tone: 'info' },
  meeting: { icon: Users, tone: 'info' },
  email_out: { icon: Send },
  email_in: { icon: MessageSquareReply, tone: 'success' },
  stage_change: { icon: Workflow, tone: 'accent' },
  task_done: { icon: CheckCircle2, tone: 'success' },
  research: { icon: Sparkles, tone: 'accent' },
  campaign: { icon: Mail },
  system: { icon: CircleDot },
};

const ACTIVITY_LABEL: Record<string, string> = {
  note: 'Note',
  voice_note: 'Voice note',
  call: 'Call logged',
  meeting: 'Meeting',
  email_out: 'Email sent',
  email_in: 'Reply received',
  stage_change: 'Stage changed',
  task_done: 'Task completed',
  research: 'Research',
  campaign: 'Campaign',
  system: 'Update',
};

const JOB_TONE: Record<string, BadgeTone> = { queued: 'neutral', running: 'info', completed: 'success', failed: 'danger', canceled: 'neutral' };
const CAMPAIGN_TONE: Record<string, BadgeTone> = { draft: 'neutral', scheduled: 'info', sending: 'accent', paused: 'warning', completed: 'success', canceled: 'neutral' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function dueLabel(iso: string | null, now: Date) {
  if (!iso) return { text: 'No date', overdue: false };
  const d = new Date(iso);
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  if (d < startToday) {
    const days = Math.max(1, Math.round((startToday.getTime() - d.getTime()) / 86_400_000));
    return { text: days === 1 ? 'Yesterday' : `${days}d overdue`, overdue: true };
  }
  const hasTime = !(d.getHours() === 0 && d.getMinutes() === 0);
  return { text: hasTime ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'Today', overdue: false };
}

const TASK_ICON: Record<string, LucideIcon> = { call: Phone, email: Mail, meeting: Users, follow_up: CalendarClock, site_visit: Building2, todo: CircleDot };

export default function DashboardPage() {
  const { data, error, isLoading, mutate } = useApi<Dashboard>('/api/dashboard', { refreshInterval: 60_000 });
  const toast = useToast();
  const [done, setDone] = useState<Set<string>>(new Set());
  const now = useMemo(() => new Date(), []);
  const title = `${greeting(now)}${data?.firstName ? `, ${data.firstName}` : ''}`;
  const dateLine = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const completeTask = async (id: string) => {
    setDone((s) => new Set(s).add(id));
    try {
      await apiPatch(`/api/tasks/${id}`, { status: 'done' });
      toast.success('Task completed');
      void mutate();
    } catch (e) {
      setDone((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      toast.error('Could not complete task', e instanceof Error ? e.message : undefined);
    }
  };

  const stageCounts = useMemo(() => {
    const map = new Map((data?.stages ?? []).map((s) => [s.stage, s.count]));
    return STAGES.map((s) => ({ ...s, count: map.get(s.key) ?? 0 }));
  }, [data?.stages]);
  const maxStage = Math.max(1, ...stageCounts.map((s) => s.count));
  const totalCompanies = stageCounts.reduce((a, s) => a + s.count, 0);

  const k = data?.kpis;
  const setup = data?.setup;
  const setupSteps = setup
    ? [
        { key: 'leads', done: setup.jobs > 0, title: 'Find leads', body: 'Search HUD, city and utility data for multifamily owners.', href: '/leads', icon: Sparkles, cta: 'Find leads' },
        { key: 'company', done: setup.companies > 0, title: 'Add a company', body: 'Create a record or import a CSV of prospects.', href: '/companies?new=1', icon: Building2, cta: 'Add company' },
        { key: 'email', done: setup.mailboxes > 0, title: 'Connect email', body: 'Send campaigns and sync replies from your inbox.', href: '/settings/email', icon: Mail, cta: 'Connect email' },
      ]
    : [];
  const setupLeft = setupSteps.filter((s) => !s.done).length;

  const todayItems = [
    ...(data?.tasks ?? []).filter((t) => !done.has(t.id)).map((t) => ({ kind: 'task' as const, id: t.id, at: t.due_at, task: t })),
    ...(data?.followUps ?? []).map((f) => ({ kind: 'follow' as const, id: f.id, at: f.next_follow_up_at, follow: f })),
  ].sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));

  const timeline: TimelineItem[] = (data?.activity ?? []).map((a) => {
    const meta = ACTIVITY_ICON[a.type] ?? ACTIVITY_ICON.system;
    const title = a.subject?.trim() || ACTIVITY_LABEL[a.type] || 'Update';
    return {
      id: a.id,
      icon: meta.icon,
      tone: meta.tone,
      title: title,
      body: a.body ? <span className="clamp-2">{a.body}</span> : undefined,
      meta: a.company_name ? (
        <Link className="dash-meta-link" href={`/companies/${a.company_id}`}>
          {a.company_name}
        </Link>
      ) : undefined,
      time: formatRelative(a.occurred_at, now),
    };
  });

  const sentDelta = k && k.sentPrev7d > 0 ? Math.round(((k.sent7d - k.sentPrev7d) / k.sentPrev7d) * 100) : null;

  return (
    <div className="page dash">
      <PageHeader
        title={title}
        shellTitle="Home"
        subtitle={
          <>
            {dateLine}
            {k && (k.tasksToday + k.tasksOverdue > 0 || (data?.followUps.length ?? 0) > 0) ? (
              <> · {k.tasksToday + k.tasksOverdue + (data?.followUps.length ?? 0)} things need you today</>
            ) : null}
          </>
        }
        actions={
          <>
            <Button icon={Sparkles} href="/leads">
              Find leads
            </Button>
            <Button variant="primary" icon={Plus} href="/companies?new=1">
              Add company
            </Button>
          </>
        }
      />

      {error && !data ? (
        <Card>
          <EmptyState icon={Target} title="Dashboard is unavailable" description={error.message} actions={<Button onClick={() => void mutate()}>Try again</Button>} />
        </Card>
      ) : null}

      {setupLeft > 0 && (
        <section className="dash-setup" aria-label="Get started">
          <div className="dash-setup__head">
            <div>
              <h2 className="dash-setup__title">Get Puma ready</h2>
              <p className="dash-setup__sub">{3 - setupLeft} of 3 done · the fastest path to your first meeting</p>
            </div>
            <div className="dash-setup__meter" aria-hidden>
              {setupSteps.map((s) => (
                <span key={s.key} className={s.done ? 'is-done' : undefined} />
              ))}
            </div>
          </div>
          <div className="dash-setup__steps">
            {setupSteps.map((s, i) => {
              const Icon = s.icon;
              return (
                <Link key={s.key} href={s.href} className={`dash-step${s.done ? ' is-done' : ''}`}>
                  <span className="dash-step__icon">{s.done ? <Check aria-hidden /> : <Icon aria-hidden />}</span>
                  <span className="dash-step__text">
                    <span className="dash-step__title">
                      <span className="dash-step__num">{i + 1}</span>
                      {s.title}
                    </span>
                    <span className="dash-step__body">{s.done ? 'Done' : s.body}</span>
                  </span>
                  {!s.done && <ArrowRight className="dash-step__go" aria-hidden />}
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="dash-kpis" aria-label="Key numbers">
        {k ? (
          <>
            <Stat label="In pipeline" value={formatNumber(k.pipeline)} icon={Workflow} hint={k.newCompanies7d ? `+${k.newCompanies7d} added this week` : 'Open opportunities'} href="/pipeline" />
            <Stat label="Qualified leads" value={formatNumber(k.qualified)} icon={Target} hint="Ready for outreach" href="/companies?stage=qualified" />
            <Stat
              label="Tasks due"
              value={formatNumber(k.tasksToday + k.tasksOverdue)}
              icon={CalendarClock}
              tone={k.tasksOverdue > 0 ? 'warning' : 'default'}
              hint={k.tasksOverdue > 0 ? `${k.tasksOverdue} overdue` : 'Due today'}
              href="/tasks"
            />
            <Stat
              label="Emails sent · 7d"
              value={formatNumber(k.sent7d)}
              icon={Send}
              delta={sentDelta != null ? `${sentDelta > 0 ? '+' : ''}${sentDelta}%` : undefined}
              hint={sentDelta != null ? 'vs last week' : 'Across all mailboxes'}
              href="/campaigns"
            />
            <Stat
              label="Reply rate · 30d"
              value={k.replyRate == null ? '—' : `${(k.replyRate * 100).toFixed(k.replyRate < 0.1 ? 1 : 0)}%`}
              icon={MailOpen}
              hint={k.sent30d ? `${k.replies30d} of ${k.sent30d} replied` : 'No sends yet'}
              href="/inbox"
            />
            <Stat label="Active clients" value={formatNumber(k.clients)} icon={Trophy} tone={k.clients > 0 ? 'success' : 'default'} hint="Metering with Puma" href="/companies?stage=client" />
          </>
        ) : (
          Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="ui-stat">
              <Skeleton width="55%" height={12} />
              <Skeleton width="40%" height={24} />
              <Skeleton width="70%" height={10} />
            </div>
          ))
        )}
      </section>

      <div className="dash-grid">
        <div className="dash-col">
          <Card
            title="Today"
            description={todayItems.length ? `${todayItems.length} task${todayItems.length === 1 ? '' : 's'} and follow-ups` : undefined}
            actions={
              <Button size="sm" variant="ghost" href="/tasks" iconRight={ArrowRight}>
                All tasks
              </Button>
            }
            flush
          >
            {isLoading && !data ? (
              <div className="dash-pad stack-sm">
                <Skeleton height={16} />
                <Skeleton height={16} />
                <Skeleton height={16} width="70%" />
              </div>
            ) : todayItems.length === 0 ? (
              <EmptyState
                compact
                icon={CheckCircle2}
                title="You're all caught up"
                description="No tasks or follow-ups due today. Line up your next conversations from the pipeline."
                actions={
                  <Button size="sm" href="/pipeline" icon={Workflow}>
                    Open pipeline
                  </Button>
                }
              />
            ) : (
              <ul className="ui-list">
                {todayItems.map((item) => {
                  if (item.kind === 'task') {
                    const t = item.task;
                    const due = dueLabel(t.due_at, now);
                    const Icon = TASK_ICON[t.type] ?? CircleDot;
                    return (
                      <li key={`t-${t.id}`} className="ui-list__item dash-task">
                        <button type="button" className="dash-check" aria-label={`Complete “${t.title}”`} onClick={() => void completeTask(t.id)}>
                          <Check aria-hidden />
                        </button>
                        <div className="ui-list__main">
                          <span className="ui-list__title">{t.title}</span>
                          <span className="ui-list__sub row" style={{ gap: 6 }}>
                            <Icon size={12} aria-hidden />
                            {t.company_name ? (
                              <Link href={`/companies/${t.company_id}`} className="truncate">
                                {t.company_name}
                              </Link>
                            ) : (
                              <span>{cap(t.type.replace('_', ' '))}</span>
                            )}
                          </span>
                        </div>
                        <div className="ui-list__end">
                          {t.priority === 'high' && <Badge tone="accent">High</Badge>}
                          <span className={due.overdue ? 'dash-due dash-due--late' : 'dash-due'}>{due.text}</span>
                        </div>
                      </li>
                    );
                  }
                  const f = item.follow;
                  const due = dueLabel(f.next_follow_up_at, now);
                  return (
                    <li key={`f-${f.id}`}>
                      <Link href={`/companies/${f.id}`} className="ui-list__item">
                        <span className="dash-follow-icon">
                          <CalendarClock aria-hidden />
                        </span>
                        <div className="ui-list__main">
                          <span className="ui-list__title">Follow up with {f.name}</span>
                          <span className="ui-list__sub">{[f.city, f.state].filter(Boolean).join(', ') || 'Company follow-up'}</span>
                        </div>
                        <div className="ui-list__end">
                          <span className="hide-mobile">
                            <StageBadge stage={f.stage} />
                          </span>
                          <span className={due.overdue ? 'dash-due dash-due--late' : 'dash-due'}>{due.text}</span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Recent activity" description="Notes, calls, emails and stage changes across your accounts">
            {isLoading && !data ? (
              <Skeleton lines={4} />
            ) : timeline.length ? (
              <Timeline items={timeline} />
            ) : (
              <EmptyState
                compact
                icon={NotebookPen}
                title="No activity yet"
                description="Calls, notes, emails and stage changes will appear here as your team works."
                actions={
                  <Button size="sm" icon={Plus} href="/companies?new=1">
                    Add company
                  </Button>
                }
              />
            )}
          </Card>
        </div>

        <div className="dash-col">
          <Card
            title="Pipeline"
            description={totalCompanies ? `${formatNumber(totalCompanies)} companies` : undefined}
            actions={
              <Button size="sm" variant="ghost" href="/pipeline" iconRight={ArrowRight}>
                Board
              </Button>
            }
          >
            {isLoading && !data ? (
              <Skeleton lines={6} />
            ) : totalCompanies === 0 ? (
              <EmptyState
                compact
                icon={Workflow}
                title="Your pipeline is empty"
                description="Save leads from a search or add companies to start tracking deals."
                actions={
                  <>
                    <Button size="sm" variant="primary" icon={Sparkles} href="/leads">
                      Find leads
                    </Button>
                    <Button size="sm" icon={FileUp} href="/settings/import-export">
                      Import CSV
                    </Button>
                  </>
                }
              />
            ) : (
              <ul className="dash-stages">
                {stageCounts.map((s) => (
                  <li key={s.key}>
                    <Link href={`/companies?stage=${s.key}`} className="dash-stage">
                      <span className="dash-stage__label">
                        <span className="dash-stage__dot" style={{ background: s.color }} />
                        {s.label}
                      </span>
                      <span className="dash-stage__bar">
                        <span style={{ width: `${s.count ? Math.max(4, (s.count / maxStage) * 100) : 0}%`, background: s.color }} />
                      </span>
                      <span className="dash-stage__count num">{s.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Lead engine"
            actions={
              <Button size="sm" variant="ghost" href="/leads" iconRight={ArrowRight}>
                Find leads
              </Button>
            }
            flush={!!data?.jobs.length}
          >
            {isLoading && !data ? (
              <Skeleton lines={3} />
            ) : data?.jobs.length ? (
              <ul className="ui-list">
                {data.jobs.map((j) => (
                  <li key={j.id}>
                    <Link href={`/leads/${j.id}`} className="ui-list__item dash-job">
                      <div className="ui-list__main">
                        <span className="ui-list__title">{j.title}</span>
                        {j.status === 'running' || j.status === 'queued' ? (
                          <ProgressBar value={j.status === 'queued' ? null : j.progress} tone="accent" size="sm" label={j.stage ?? (j.status === 'queued' ? 'Queued' : 'Researching…')} />
                        ) : (
                          <span className="ui-list__sub">
                            {j.status === 'failed' ? j.error ?? 'Failed' : `${formatNumber(j.candidates)} leads found`} · {formatRelative(j.finished_at ?? j.created_at, now)}
                          </span>
                        )}
                      </div>
                      <div className="ui-list__end">
                        <Badge tone={JOB_TONE[j.status] ?? 'neutral'} dot>
                          {cap(j.status)}
                        </Badge>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                compact
                icon={Sparkles}
                title="No lead searches yet"
                description="Find multifamily owners and managers by market, building size and water spend."
                actions={
                  <Button size="sm" variant="primary" icon={Sparkles} href="/leads">
                    Find leads
                  </Button>
                }
              />
            )}
          </Card>

          <Card
            title="Campaigns"
            actions={
              <Button size="sm" variant="ghost" href="/campaigns" iconRight={ArrowRight}>
                All
              </Button>
            }
            flush={!!data?.campaigns.length}
          >
            {isLoading && !data ? (
              <Skeleton lines={3} />
            ) : data?.campaigns.length ? (
              <ul className="ui-list">
                {data.campaigns.map((c) => {
                  const openRate = c.sent ? Math.round((c.opened / c.sent) * 100) : null;
                  const replyRate = c.sent ? Math.round((c.replied / c.sent) * 100) : null;
                  return (
                    <li key={c.id}>
                      <Link href={`/campaigns/${c.id}`} className="ui-list__item dash-campaign">
                        <div className="ui-list__main">
                          <span className="ui-list__title">{c.name}</span>
                          <span className="dash-campaign__stats">
                            <span>
                              <b className="num">{formatNumber(c.sent)}</b>/{formatNumber(c.recipients)} sent
                            </span>
                            <span>
                              <b className="num">{openRate == null ? '—' : `${openRate}%`}</b> opened
                            </span>
                            <span>
                              <b className="num">{replyRate == null ? '—' : `${replyRate}%`}</b> replied
                            </span>
                          </span>
                        </div>
                        <div className="ui-list__end">
                          <Badge tone={CAMPAIGN_TONE[c.status] ?? 'neutral'}>{cap(c.status)}</Badge>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                compact
                icon={Send}
                title="No campaigns yet"
                description={setup && setup.mailboxes === 0 ? 'Connect a mailbox to send personalized sequences and track replies.' : 'Reach qualified owners with a personalized email sequence.'}
                actions={
                  setup && setup.mailboxes === 0 ? (
                    <Button size="sm" variant="primary" icon={Mail} href="/settings/email">
                      Connect email
                    </Button>
                  ) : (
                    <Button size="sm" variant="primary" icon={TrendingUp} href="/campaigns/new">
                      New campaign
                    </Button>
                  )
                }
              />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
