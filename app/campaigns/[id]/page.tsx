'use client';

import '../campaigns.css';
import { AlertTriangle, Eye, MailCheck, MousePointerClick, Pause, Play, MoreHorizontal, Plus, Rocket, Trash2, UserMinus, Reply, XCircle } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Badge, Button, Card, DataTable, EmptyState, FilterChips, IconButton, Input, Menu, Modal, PageHeader, SearchInput, Sheet, Skeleton, Stat, Textarea, useToast,
  formatNumber, formatRelative, type DataTableColumn,
} from '@/app/ui';
import { ClientApiError, apiDelete, apiPost, invalidate, useApi } from '@/lib/client/api';
import { DAY_LABELS } from '@/lib/email/settings';
import { RECIPIENT_TONE, STATUS_LABEL, STATUS_TONE, type CampaignSettingsDto, type CampaignStatus } from '@/lib/email/ui/types';

type Detail = {
  campaign: {
    id: string;
    name: string;
    status: CampaignStatus;
    settings: CampaignSettingsDto;
    mailbox: { id: string; email: string; status: string; dailyLimit: number } | null;
    lastError: string | null;
    started_at: string | null;
  };
  steps: { id: string; position: number; delay_days: number; subject: string }[];
  stats: Totals;
  readiness: { level: 'error' | 'warning'; message: string }[];
};
type Totals = { total: number; queued: number; active: number; completed: number; contacted: number; sent: number; opened: number; clicked: number; replied: number; bounced: number; unsubscribed: number; failed: number; skipped: number };
type StatsPayload = {
  totals: Totals;
  rates: { open: number; click: number; reply: number; bounce: number; unsubscribe: number };
  steps: { step: number; subject: string; delayDays: number; sent: number; opened: number; clicked: number; replied: number }[];
};
type Recipient = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  company_id: string | null;
  status: string;
  current_step: number;
  next_send_at: string | null;
  last_sent_at: string | null;
  opened_at: string | null;
  open_count: number;
  clicked_at: string | null;
  replied_at: string | null;
  error: string | null;
};

const FILTERS = ['all', 'queued', 'active', 'completed', 'replied', 'bounced', 'unsubscribed', 'failed'] as const;

function fmtTime(zone: string, value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', { timeZone: zone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function CampaignDashboard() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { data, isLoading, mutate, error } = useApi<Detail>(`/api/campaigns/${id}`, { refreshInterval: 15_000 });
  const stats = useApi<StatsPayload>(`/api/campaigns/${id}/stats`, { refreshInterval: 15_000 });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [q, setQ] = useState('');
  const recipientsUrl = `/api/campaigns/${id}/recipients?status=${filter}${q ? `&q=${encodeURIComponent(q)}` : ''}&limit=200`;
  const recipients = useApi<{ recipients: Recipient[]; counts: Record<string, number> }>(recipientsUrl, { refreshInterval: 15_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testStep, setTestStep] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const [issues, setIssues] = useState<Detail['readiness'] | null>(null);

  const c = data?.campaign;
  const totals = stats.data?.totals ?? data?.stats;
  const refresh = async () => {
    await Promise.all([mutate(), stats.mutate(), recipients.mutate(), invalidate('/api/campaigns')]);
  };

  const run = async (kind: 'launch' | 'pause' | 'resume') => {
    setBusy(kind);
    setIssues(null);
    try {
      await apiPost(`/api/campaigns/${id}/${kind}`, {});
      toast.success(kind === 'launch' ? 'Campaign launched' : kind === 'pause' ? 'Campaign paused' : 'Campaign resumed');
      await refresh();
    } catch (e) {
      if (e instanceof ClientApiError && e.details && typeof e.details === 'object' && 'issues' in (e.details as object)) setIssues((e.details as { issues: Detail['readiness'] }).issues);
      toast.error(kind === 'launch' ? 'Not ready to launch' : 'Could not update campaign', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async () => {
    setBusy('test');
    try {
      const res = await apiPost<{ to: string }>(`/api/campaigns/${id}/test`, { stepIndex: testStep, to: testTo || undefined });
      toast.success('Test email sent', `Check ${res.to}`);
      setTestOpen(false);
    } catch (e) {
      toast.error('Could not send test', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const addRecipients = async () => {
    setBusy('add');
    try {
      const looksCsv = pasted.includes('\n') && /(^|\n)\s*(email|e-mail)\b/i.test(pasted.split('\n')[0]);
      const res = await apiPost<{ added: number; duplicates: number; suppressed: number; unsubscribed: number; invalid: number }>(`/api/campaigns/${id}/recipients`, looksCsv ? { csv: pasted } : { emails: [pasted] });
      toast.success(`${res.added} recipient${res.added === 1 ? '' : 's'} added`, [res.duplicates && `${res.duplicates} duplicates`, res.suppressed + res.unsubscribed && `${res.suppressed + res.unsubscribed} suppressed`, res.invalid && `${res.invalid} invalid`].filter(Boolean).join(' · ') || undefined);
      setPasted('');
      setAddOpen(false);
      await refresh();
    } catch (e) {
      toast.error('Could not add recipients', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (r: Recipient) => {
    try {
      await apiDelete(`/api/campaigns/${id}/recipients/${r.id}`);
      await refresh();
    } catch (e) {
      toast.error('Could not remove', e instanceof Error ? e.message : undefined);
    }
  };

  const deleteCampaign = async () => {
    if (!window.confirm('Delete this campaign and its recipient history? Emails already sent are not recalled.')) return;
    try {
      await apiDelete(`/api/campaigns/${id}`);
      await invalidate('/api/campaigns');
      router.push('/campaigns');
    } catch (e) {
      toast.error('Could not delete', e instanceof Error ? e.message : undefined);
    }
  };

  if (error) {
    return (
      <div className="page">
        <PageHeader title="Campaign" back={{ href: '/campaigns', label: 'Campaigns' }} />
        <EmptyState title="Campaign not found" description={(error as Error).message} actions={<Button href="/campaigns">Back to campaigns</Button>} />
      </div>
    );
  }
  if (isLoading || !c || !totals) {
    return (
      <div className="page">
        <PageHeader title="Campaign" back={{ href: '/campaigns', label: 'Campaigns' }} />
        <div className="stack">
          <Skeleton height={84} />
          <Skeleton height={220} />
        </div>
      </div>
    );
  }

  const s = c.settings;
  const tz = s.timezone;
  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 1000) / 10}%` : '—');
  const days = s.sendDays.map((d) => DAY_LABELS[d - 1]).join(', ');
  const blockers = (issues ?? data?.readiness ?? []).filter((i) => c.status === 'draft' || c.status === 'paused' ? true : i.level === 'error');

  const columns: DataTableColumn<Recipient>[] = [
    {
      key: 'email',
      header: 'Recipient',
      mobile: 'title',
      cell: (r) => (
        <div className="rcp-cell">
          <span className="strong truncate">{[r.first_name, r.last_name].filter(Boolean).join(' ') || r.email}</span>
          <small>{[r.first_name || r.last_name ? r.email : null, r.company_name].filter(Boolean).join(' · ') || ' '}</small>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      mobile: 'trailing',
      cell: (r) => (
        <Badge tone={RECIPIENT_TONE[r.status] ?? 'neutral'} title={r.error ?? undefined}>
          {r.status}
        </Badge>
      ),
    },
    { key: 'step', header: 'Step', mobileLabel: 'Step', cell: (r) => `${r.current_step}/${data.steps.length}` },
    { key: 'last', header: 'Last sent', mobileLabel: 'Last sent', cell: (r) => (r.last_sent_at ? formatRelative(r.last_sent_at) : '—') },
    { key: 'next', header: 'Next send', mobileLabel: 'Next', cell: (r) => (['queued', 'active'].includes(r.status) ? fmtTime(tz, r.next_send_at) : '—') },
    {
      key: 'engage',
      header: 'Engagement',
      mobile: 'meta',
      mobileLabel: 'Engaged',
      cell: (r) => (
        <span className="rcp-flags">
          <span className={r.opened_at ? 'on' : ''} title={r.opened_at ? `Opened ${r.open_count}x` : 'Not opened'}><Eye size={15} /></span>
          <span className={r.clicked_at ? 'on' : ''} title={r.clicked_at ? 'Clicked' : 'No clicks'}><MousePointerClick size={15} /></span>
          <span className={r.replied_at ? 'on' : ''} title={r.replied_at ? 'Replied' : 'No reply'}><Reply size={15} /></span>
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      mobile: 'hidden',
      width: 48,
      align: 'right',
      cell: (r) => (
        <span data-no-row-click>
          <IconButton icon={UserMinus} label="Remove from campaign" size="sm" onClick={() => void remove(r)} />
        </span>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        back={{ href: '/campaigns', label: 'Campaigns' }}
        title={c.name}
        shellTitle={c.name}
        subtitle={`${c.mailbox?.email ?? 'No sender'} · ${data.steps.length} email${data.steps.length === 1 ? '' : 's'} · ${s.dailyLimit}/day · ${s.windowStart}–${s.windowEnd} ${tz.split('/')[1]?.replace('_', ' ') ?? tz}, ${days}`}
        actions={
          <>
            <Badge tone={STATUS_TONE[c.status]} dot>
              {STATUS_LABEL[c.status]}
            </Badge>
            {c.status === 'draft' && (
              <Button variant="primary" icon={Rocket} loading={busy === 'launch'} onClick={() => run('launch')}>
                Launch
              </Button>
            )}
            {c.status === 'sending' && (
              <Button icon={Pause} loading={busy === 'pause'} onClick={() => run('pause')}>
                Pause
              </Button>
            )}
            {c.status === 'paused' && (
              <Button variant="primary" icon={Play} loading={busy === 'resume'} onClick={() => run('resume')}>
                Resume
              </Button>
            )}
            <Menu
              trigger={<Button variant="secondary" icon={MoreHorizontal}>More</Button>}
              items={[
                { label: 'Send a test to myself', icon: MailCheck, onSelect: () => setTestOpen(true) },
                { label: 'Add recipients', icon: Plus, onSelect: () => setAddOpen(true) },
                { separator: true },
                { label: 'Delete campaign', icon: Trash2, danger: true, onSelect: () => void deleteCampaign() },
              ]}
            />
          </>
        }
      />

      <div className="stack-lg">
        {c.lastError && c.status === 'paused' && (
          <div className="issue issue--error" role="alert">
            <XCircle size={16} color="var(--danger)" />
            <span><strong>Paused automatically.</strong> {c.lastError}</span>
          </div>
        )}
        {c.status !== 'sending' && c.status !== 'completed' && blockers.length > 0 && (
          <div className="stack-sm">
            {blockers.map((i) => (
              <div key={i.message} className={`issue issue--${i.level}`}>
                <AlertTriangle size={16} color={i.level === 'error' ? 'var(--danger)' : 'var(--warning)'} />
                <span>{i.message}</span>
              </div>
            ))}
          </div>
        )}

        <div className="cmp-stats cmp-stats--6">
          <Stat label="Recipients" value={formatNumber(totals.total)} hint={`${totals.queued + totals.active} in progress`} />
          <Stat label="Contacted" value={formatNumber(totals.contacted)} hint={`${totals.sent} emails sent`} />
          <Stat label="Opened" value={pct(totals.opened, totals.contacted)} hint={`${totals.opened} people`} />
          <Stat label="Replied" value={pct(totals.replied, totals.contacted)} hint={`${totals.replied} people`} tone={totals.replied ? 'success' : 'default'} />
          <Stat label="Bounced" value={totals.bounced} tone={totals.bounced ? 'danger' : 'default'} hint={pct(totals.bounced, totals.contacted + totals.bounced)} />
          <Stat label="Unsubscribed" value={totals.unsubscribed} tone={totals.unsubscribed ? 'warning' : 'default'} />
        </div>

        <div className="grid-2">
          <Card title="Funnel">
            <div className="funnel">
              {[
                { label: 'Contacted', n: totals.contacted, cls: '' },
                { label: 'Opened', n: totals.opened, cls: 'funnel__bar--info' },
                { label: 'Clicked', n: totals.clicked, cls: 'funnel__bar--violet' },
                { label: 'Replied', n: totals.replied, cls: 'funnel__bar--success' },
                { label: 'Bounced', n: totals.bounced, cls: 'funnel__bar--danger' },
              ].map((row) => (
                <div className="funnel__row" key={row.label}>
                  <span className="funnel__label">{row.label}</span>
                  <div className="funnel__track">
                    <div className={`funnel__bar ${row.cls}`} style={{ width: `${totals.total ? Math.max(row.n ? 2 : 0, (row.n / Math.max(1, totals.total)) * 100) : 0}%` }} />
                  </div>
                  <span className="funnel__val">
                    {row.n}
                    <small>{pct(row.n, totals.contacted || totals.total)}</small>
                  </span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="By email">
            <div className="step-table">
              <div className="step-row step-row--head">
                <span />
                <span>Email</span>
                <span className="step-row__num">Sent</span>
                <span className="step-row__num">Open</span>
                <span className="step-row__num">Click</span>
                <span className="step-row__num">Reply</span>
              </div>
              {(stats.data?.steps ?? data.steps.map((st) => ({ step: st.position, subject: st.subject, delayDays: st.delay_days, sent: 0, opened: 0, clicked: 0, replied: 0 }))).map((st) => (
                <div className="step-row" key={st.step}>
                  <span className="step-row__n">{st.step + 1}</span>
                  <span className="step-row__subject">
                    <span className="truncate strong">{st.subject || 'Re: (same thread)'}</span>
                    <span className="text-xs subtle">{st.step === 0 ? 'Sent first' : `${st.delayDays} day${st.delayDays === 1 ? '' : 's'} after previous`}</span>
                  </span>
                  <span className="step-row__num">{st.sent}</span>
                  <span className="step-row__num">{st.opened}</span>
                  <span className="step-row__num">{st.clicked}</span>
                  <span className="step-row__num">{st.replied}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card
          title="Recipients"
          flush
          actions={
            <Button size="sm" icon={Plus} onClick={() => setAddOpen(true)}>
              Add
            </Button>
          }
        >
          <div className="stack" style={{ padding: '0 16px 12px' }}>
            <FilterChips
              value={filter}
              onChange={(v) => setFilter(v as (typeof FILTERS)[number])}
              options={FILTERS.map((f) => ({ value: f, label: f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1), count: f === 'all' ? totals.total : (recipients.data?.counts[f] ?? 0) }))}
              aria-label="Filter recipients"
            />
            <SearchInput value={q} onChange={setQ} debounce={250} placeholder="Search recipients" />
          </div>
          <DataTable
            rows={recipients.data?.recipients ?? []}
            columns={columns}
            loading={recipients.isLoading}
            aria-label="Recipients"
            empty={<EmptyState compact title="No recipients match" description={filter === 'all' ? 'Add recipients to get started.' : 'Try a different filter.'} />}
          />
        </Card>
      </div>

      <Modal
        open={testOpen}
        onClose={() => setTestOpen(false)}
        title="Send a test"
        description="Sends one email from this campaign's account to the address below, filled in with sample data."
        footer={
          <>
            <Button variant="ghost" onClick={() => setTestOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={busy === 'test'} onClick={sendTest}>Send test</Button>
          </>
        }
      >
        <div className="stack">
          <Input type="email" placeholder={c.mailbox?.email ?? 'you@company.com'} value={testTo} onChange={(e) => setTestTo(e.target.value)} aria-label="Send test to" />
          {data.steps.length > 1 && (
            <div className="row-wrap">
              {data.steps.map((st) => (
                <Button key={st.id} size="sm" variant={testStep === st.position ? 'primary' : 'secondary'} onClick={() => setTestStep(st.position)}>
                  Email {st.position + 1}
                </Button>
              ))}
            </div>
          )}
        </div>
      </Modal>

      <Sheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add recipients"
        description="Paste email addresses (one per line or comma separated), or CSV text with an email column and optional first_name, last_name, company."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={busy === 'add'} disabled={!pasted.trim()} onClick={addRecipients}>Add</Button>
          </>
        }
      >
        <Textarea rows={10} className="textarea-mono" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={'email,first_name,last_name,company\njane@acme.com,Jane,Doe,Acme Properties'} />
        <p className="text-sm subtle" style={{ marginTop: 8 }}>Unsubscribed, bounced and suppressed addresses are skipped automatically. To add CRM contacts, use the campaign wizard or the CRM list.</p>
      </Sheet>
    </div>
  );
}
