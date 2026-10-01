'use client';

import './campaigns.css';
import { Mail, Plus, Send } from 'lucide-react';
import { Badge, Button, EmptyState, PageHeader, ProgressBar, Stat, formatNumber, formatRelative, DataTable, type DataTableColumn } from '@/app/ui';
import { useApi } from '@/lib/client/api';
import { STATUS_LABEL, STATUS_TONE, type CampaignListItem, type MailboxDto } from '@/lib/email/ui/types';

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');

export default function CampaignsPage() {
  const { data, isLoading } = useApi<{ campaigns: CampaignListItem[] }>('/api/campaigns', { refreshInterval: 20_000 });
  const mailboxes = useApi<{ mailboxes: MailboxDto[] }>('/api/mail/mailboxes', { revalidateOnFocus: false });
  const rows = data?.campaigns ?? [];
  const noMailbox = mailboxes.data && mailboxes.data.mailboxes.length === 0;

  const sent = rows.reduce((n, c) => n + c.contacted, 0);
  const replied = rows.reduce((n, c) => n + c.replied, 0);
  const opened = rows.reduce((n, c) => n + c.opened, 0);
  const running = rows.filter((c) => c.status === 'sending').length;

  const columns: DataTableColumn<CampaignListItem>[] = [
    {
      key: 'name',
      header: 'Campaign',
      mobile: 'title',
      cell: (c) => (
        <div className="rcp-cell">
          <span className="strong truncate">{c.name}</span>
          <small>
            {c.steps} email{c.steps === 1 ? '' : 's'} · {c.mailbox_email ?? 'no sender'} · {formatRelative(c.started_at ?? c.created_at)}
          </small>
        </div>
      ),
      sortValue: (c) => c.name.toLowerCase(),
      sortable: true,
    },
    {
      key: 'status',
      header: 'Status',
      mobile: 'trailing',
      cell: (c) => (
        <Badge tone={STATUS_TONE[c.status]} dot>
          {STATUS_LABEL[c.status]}
        </Badge>
      ),
    },
    {
      key: 'progress',
      header: 'Progress',
      mobile: 'subtitle',
      width: 180,
      cell: (c) => <ProgressBar className="cmp-progress" size="sm" value={c.total ? (c.contacted / c.total) * 100 : 0} valueLabel={`${c.contacted}/${c.total}`} />,
    },
    { key: 'opened', header: 'Opened', align: 'right', mobileLabel: 'Opened', cell: (c) => pct(c.opened, c.contacted), sortable: true, sortValue: (c) => (c.contacted ? c.opened / c.contacted : 0) },
    { key: 'replied', header: 'Replies', align: 'right', mobileLabel: 'Replies', cell: (c) => (c.replied ? `${c.replied} (${pct(c.replied, c.contacted)})` : '0'), sortable: true, sortValue: (c) => c.replied },
    { key: 'bounced', header: 'Bounced', align: 'right', mobileLabel: 'Bounced', cell: (c) => c.bounced },
    { key: 'unsubscribed', header: 'Unsub', align: 'right', mobile: 'hidden', cell: (c) => c.unsubscribed },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Campaigns"
        subtitle="Email sequences to multifamily owners and managers, sent from your own mailbox."
        actions={
          <Button variant="primary" icon={Plus} href="/campaigns/new">
            New campaign
          </Button>
        }
      />
      <div className="stack-lg">
        {noMailbox && (
          <div className="note note--warn" style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--warning-soft)', border: '1px solid rgba(245,181,68,.3)' }}>
            <span className="row" style={{ gap: 10 }}>
              <Mail size={16} aria-hidden />
              <span className="grow">Connect an email account before sending campaigns.</span>
              <Button size="sm" href="/settings/email">
                Connect email
              </Button>
            </span>
          </div>
        )}
        {rows.length > 0 && (
          <div className="cmp-stats">
            <Stat label="Running" value={running} hint={`${rows.length} total`} />
            <Stat label="Emails sent" value={formatNumber(sent)} />
            <Stat label="Open rate" value={pct(opened, sent)} hint={`${replied} repl${replied === 1 ? 'y' : 'ies'}`} />
          </div>
        )}
        <DataTable
          rows={rows}
          columns={columns}
          loading={isLoading}
          rowHref={(c) => `/campaigns/${c.id}`}
          aria-label="Campaigns"
          empty={
            <EmptyState
              icon={Send}
              title="No campaigns yet"
              description="Pick companies from your CRM, write a short sequence with follow-ups, and Puma sends it slowly and safely from your mailbox. Sequences stop the moment someone replies."
              actions={
                <Button variant="primary" icon={Plus} href="/campaigns/new">
                  Create your first campaign
                </Button>
              }
            />
          }
        />
      </div>
    </div>
  );
}
