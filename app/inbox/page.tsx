'use client';

import './inbox.css';
import { Building2, ChevronLeft, CornerUpLeft, Inbox as InboxIcon, Mail, PenSquare, RefreshCw, Send, Settings2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Badge, Button, Chip, EmptyState, Field, IconButton, Input, SearchInput, Select, Sheet, Skeleton, Tabs, useToast, formatRelative } from '@/app/ui';
import { apiPost, invalidate, useApi } from '@/lib/client/api';
import { RichEditor } from '@/lib/email/ui/rich-editor';
import type { MailboxDto, ThreadDetail, ThreadListItem, ThreadMessage } from '@/lib/email/ui/types';

export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <Inbox />
    </Suspense>
  );
}

function shortTime(value: string) {
  const d = new Date(value);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return formatRelative(d);
}

function Inbox() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const folder = params.get('f') === 'sent' ? 'sent' : 'inbox';
  const selectedKey = params.get('t');
  const companyId = params.get('companyId');
  const contactId = params.get('contactId');
  const [mailboxId, setMailboxId] = useState<string>(params.get('m') ?? '');
  const [q, setQ] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const autoSynced = useRef(false);

  const { data: mbData, mutate: mutateMailboxes, isLoading: loadingMailboxes } = useApi<{ mailboxes: MailboxDto[] }>('/api/mail/mailboxes');
  const mailboxes = mbData?.mailboxes ?? [];

  const qs = new URLSearchParams({ folder });
  if (mailboxId) qs.set('mailboxId', mailboxId);
  if (companyId) qs.set('companyId', companyId);
  if (contactId) qs.set('contactId', contactId);
  if (q.trim()) qs.set('q', q.trim());
  const listKey = `/api/mail/messages?${qs.toString()}`;
  const { data: list, isLoading, mutate: mutateList } = useApi<{ threads: ThreadListItem[] }>(mailboxes.length ? listKey : null, { refreshInterval: 30_000 });
  const threads = list?.threads ?? [];
  const selected = threads.find((t) => t.threadKey === selectedKey) ?? null;

  const setParam = useCallback(
    (patch: Record<string, string | null>, push = false) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      const url = `/inbox${next.toString() ? `?${next.toString()}` : ''}`;
      if (push) router.push(url);
      else router.replace(url);
    },
    [params, router],
  );

  const syncAll = useCallback(
    async (quiet = false) => {
      const targets = mailboxes.filter((m) => m.status !== 'disconnected' && (!mailboxId || m.id === mailboxId));
      if (!targets.length) return;
      setSyncing(true);
      try {
        const results = await Promise.all(targets.map((m) => apiPost<{ result: { stored: number; replies: number; error?: string } }>(`/api/mail/mailboxes/${m.id}/sync`).catch((e: Error) => ({ result: { stored: 0, replies: 0, error: e.message } }))));
        const stored = results.reduce((n, r) => n + r.result.stored, 0);
        const failed = results.find((r) => r.result.error);
        if (failed && !quiet) toast.error('Sync problem', failed.result.error);
        else if (!quiet) toast.success(stored ? `${stored} new message${stored === 1 ? '' : 's'}` : 'You are up to date');
        await Promise.all([mutateList(), mutateMailboxes()]);
      } finally {
        setSyncing(false);
      }
    },
    [mailboxes, mailboxId, mutateList, mutateMailboxes, toast],
  );

  // Quietly refresh stale mailboxes when the inbox opens.
  useEffect(() => {
    if (autoSynced.current || !mailboxes.length) return;
    autoSynced.current = true;
    const stale = mailboxes.some((m) => m.status !== 'disconnected' && (!m.last_sync_at || Date.now() - new Date(m.last_sync_at).getTime() > 90_000));
    if (stale) void syncAll(true);
  }, [mailboxes, syncAll]);

  const unreadTotal = threads.reduce((n, t) => n + (t.unread > 0 ? 1 : 0), 0);

  if (!loadingMailboxes && mailboxes.length === 0) {
    return (
      <div className="page page--narrow">
        <div className="empty-wrap">
          <EmptyState
            icon={Mail}
            title="Go in through your email"
            description="Connect Gmail, Outlook, iCloud or any mailbox to read replies, answer prospects and see every email next to the company record."
            actions={
              <Button variant="primary" href="/settings/email" icon={Settings2}>
                Connect email
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="inbox">
      <section className="inbox__list" style={selectedKey ? undefined : undefined}>
        <div className="inbox__head">
          <div className="inbox__title-row">
            <h1>Inbox</h1>
            <div className="inbox__tools">
              <IconButton icon={RefreshCw} label="Sync now" onClick={() => void syncAll()} disabled={syncing} className={syncing ? 'is-spinning' : undefined} />
              <IconButton icon={PenSquare} label="New message" variant="secondary" onClick={() => setComposeOpen(true)} />
            </div>
          </div>
          {mailboxes.length > 1 && (
            <Select
              aria-label="Mailbox"
              value={mailboxId}
              onChange={(e) => {
                setMailboxId(e.target.value);
                setParam({ t: null, m: e.target.value || null });
              }}
              options={[{ value: '', label: 'All mailboxes' }, ...mailboxes.map((m) => ({ value: m.id, label: m.email }))]}
            />
          )}
          <Tabs
            variant="pill"
            value={folder}
            onChange={(v) => setParam({ f: v === 'sent' ? 'sent' : null, t: null })}
            items={[
              { value: 'inbox', label: 'Inbox', icon: InboxIcon, count: folder === 'inbox' && unreadTotal ? unreadTotal : null },
              { value: 'sent', label: 'Sent', icon: Send },
            ]}
            aria-label="Folder"
          />
          <SearchInput value={q} onChange={setQ} debounce={250} placeholder="Search mail" />
          {(companyId || contactId) && (
            <div className="row-wrap">
              <Chip onRemove={() => setParam({ companyId: null, contactId: null, t: null })} selected>
                {companyId ? 'Company filter' : 'Contact filter'}
              </Chip>
            </div>
          )}
        </div>
        <div className="inbox__scroll">
          {isLoading || loadingMailboxes ? (
            <div className="stack" style={{ padding: 16 }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="row" style={{ gap: 12 }}>
                  <Skeleton width={36} height={36} radius={999} />
                  <div className="grow stack-sm">
                    <Skeleton height={13} width="60%" />
                    <Skeleton height={12} />
                  </div>
                </div>
              ))}
            </div>
          ) : threads.length === 0 ? (
            <EmptyState
              compact
              icon={folder === 'sent' ? Send : InboxIcon}
              title={q ? 'No matches' : folder === 'sent' ? 'Nothing sent yet' : 'Your inbox is empty'}
              description={q ? 'Try a different search.' : 'New mail appears here after a sync.'}
              actions={
                !q && (
                  <Button size="sm" icon={RefreshCw} onClick={() => void syncAll()} loading={syncing}>
                    Sync now
                  </Button>
                )
              }
            />
          ) : (
            threads.map((t) => {
              const who = folder === 'sent' ? (t.to[0] ?? 'Unknown') : (t.fromName || t.fromEmail || 'Unknown');
              return (
                <button
                  key={`${t.mailboxId}:${t.threadKey}`}
                  type="button"
                  className={`thr${t.threadKey === selectedKey ? ' is-active' : ''}${t.unread ? ' is-unread' : ''}`}
                  onClick={() => setParam({ t: t.threadKey, m: t.mailboxId }, true)}
                >
                  <Avatar name={folder === 'sent' ? who : (t.fromName || t.fromEmail)} size="md" />
                  <span className="thr__body">
                    <span className="thr__row">
                      <span className="thr__from">{who}</span>
                      {t.messageCount > 1 && <span className="thr__count">{t.messageCount}</span>}
                      <span className="thr__time">{shortTime(t.lastAt)}</span>
                    </span>
                    <span className="thr__subject">{t.subject}</span>
                    <span className="thr__snippet">{t.snippet}</span>
                    {(t.company || t.campaign) && (
                      <span className="thr__chips">
                        {t.company && (
                          <Badge icon={Building2} tone="neutral">
                            {t.company.name}
                          </Badge>
                        )}
                        {t.campaign && (
                          <Badge tone="accent" icon={Send}>
                            Campaign
                          </Badge>
                        )}
                      </span>
                    )}
                  </span>
                  {t.unread > 0 && <span className="thr__dot" aria-label="Unread" />}
                </button>
              );
            })
          )}
        </div>
      </section>

      <ThreadPane
        key={selectedKey ?? 'none'}
        threadKey={selectedKey}
        mailboxId={selected?.mailboxId ?? (params.get('m') || '')}
        onBack={() => router.back()}
        onChanged={() => {
          void mutateList();
          void invalidate('/api/mail/threads');
        }}
      />

      <ComposeSheet open={composeOpen} onClose={() => setComposeOpen(false)} mailboxes={mailboxes} defaultMailboxId={mailboxId} onSent={() => void mutateList()} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thread pane
// ---------------------------------------------------------------------------

function ThreadPane({ threadKey, mailboxId, onBack, onChanged }: { threadKey: string | null; mailboxId: string; onBack: () => void; onChanged: () => void }) {
  const url = threadKey ? `/api/mail/threads/${encodeURIComponent(threadKey)}?markRead=1${mailboxId ? `&mailboxId=${mailboxId}` : ''}` : null;
  const { data, isLoading, error, mutate } = useApi<ThreadDetail>(url, { revalidateOnFocus: false });
  const scroller = useRef<HTMLDivElement>(null);
  const markedRef = useRef(false);

  useEffect(() => {
    if (data && !markedRef.current && data.messages.some((m) => !m.is_read)) {
      markedRef.current = true;
      onChanged();
    }
  }, [data, onChanged]);

  useEffect(() => {
    if (data) scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [data?.messages.length, data]);

  if (!threadKey) {
    return (
      <section className="pane">
        <div className="pane__empty">
          <div>
            <Mail size={28} style={{ margin: '0 auto 10px', color: 'var(--text-3)' }} />
            Select a conversation to read it
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="pane pane--mobile-open">
      <div className="pane__head">
        <IconButton icon={ChevronLeft} label="Back to inbox" className="pane__back" onClick={onBack} />
        <div className="pane__titles">
          {data ? <h2 className="pane__subject">{data.subject}</h2> : <Skeleton height={20} width="70%" />}
          {data && (data.company || data.contact || data.campaign) && (
            <div className="pane__chips">
              {data.company && (
                <Link href={`/companies/${data.company.id}`}>
                  <Badge icon={Building2} tone="info">
                    {data.company.name}
                  </Badge>
                </Link>
              )}
              {data.contact && (
                <Link href={`/contacts/${data.contact.id}`}>
                  <Badge tone="neutral">{data.contact.full_name}</Badge>
                </Link>
              )}
              {data.campaign && (
                <Link href={`/campaigns/${data.campaign.id}`}>
                  <Badge tone="accent" icon={Send}>
                    {data.campaign.name}
                  </Badge>
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="pane__scroll" ref={scroller}>
        {isLoading && !data ? (
          <Skeleton lines={6} />
        ) : error ? (
          <EmptyState compact title="Could not open this conversation" description={(error as Error).message} />
        ) : (
          data?.messages.map((m, i) => <Message key={m.id} message={m} defaultOpen={i === data.messages.length - 1 || !m.is_read} />)
        )}
      </div>
      {data && <ReplyBox thread={data} onSent={() => { void mutate(); onChanged(); }} />}
    </section>
  );
}

function Message({ message: m, defaultOpen }: { message: ThreadMessage; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const name = m.direction === 'out' ? 'You' : m.from_name || m.from_email || 'Unknown';
  return (
    <article className={`msg${m.direction === 'out' ? ' msg--out' : ''}`}>
      <button type="button" className="msg__head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Avatar name={m.direction === 'out' ? m.from_name || m.from_email : name} size="sm" />
        <span className="msg__who">
          <span className="msg__name">{name}</span>
          <span className="msg__to">to {m.to_emails.join(', ') || 'me'}</span>
        </span>
        <span className="msg__time">{new Date(m.sent_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
      </button>
      {open ? (
        <div className="msg__body">{m.body_html ? <HtmlBody html={m.body_html} /> : <div className="msg__text">{m.body_text}</div>}</div>
      ) : (
        <div className="msg__collapsed">{(m.body_text ?? '').replace(/\s+/g, ' ').slice(0, 140)}</div>
      )}
    </article>
  );
}

/** Email HTML is untrusted: render it in a script-less sandboxed iframe and size it to its content. */
function HtmlBody({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(80);
  const doc = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data: cid:; style-src 'unsafe-inline'; font-src https: data:"><base target="_blank"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0}body{padding:14px;font:14px/1.55 -apple-system,BlinkMacSystemFont,Arial,sans-serif;color:#1f1f1f;word-break:break-word;overflow-x:hidden}img{max-width:100%;height:auto}a{color:#0b57d0}table{max-width:100%}blockquote{margin:8px 0;padding-left:12px;border-left:2px solid #ccc;color:#555}</style></head><body>${html}</body></html>`,
    [html],
  );
  const measure = () => {
    const d = ref.current?.contentDocument;
    if (d) setHeight(Math.min(6000, Math.max(60, d.documentElement.scrollHeight)));
  };
  return <iframe ref={ref} className="msg__frame" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} style={{ height }} onLoad={measure} title="Message" />;
}

function ReplyBox({ thread, onSent }: { thread: ThreadDetail; onSent: () => void }) {
  const toast = useToast();
  const last = thread.messages[thread.messages.length - 1];
  const lastIn = [...thread.messages].reverse().find((m) => m.direction === 'in');
  const defaultTo = lastIn?.from_email ?? last.to_emails[0] ?? '';
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultTo);
  const [html, setHtml] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    setSending(true);
    try {
      await apiPost('/api/mail/send', { to: to.split(/[\s,;]+/).filter(Boolean), html, replyToMessageId: (lastIn ?? last).id, mailboxId: thread.mailbox?.id });
      toast.success('Reply sent');
      setHtml('');
      setOpen(false);
      onSent();
    } catch (e) {
      toast.error('Could not send', e instanceof Error ? e.message : undefined);
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <div className="composer">
        <div className="composer__bar">
          <Button variant="secondary" icon={CornerUpLeft} onClick={() => setOpen(true)} block>
            Reply
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="composer">
      <div className="composer__to">
        <span>To</span>
        <input value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" inputMode="email" autoCapitalize="off" />
      </div>
      <RichEditor value={html} onChange={setHtml} minHeight={110} placeholder="Write a reply…" compact autoFocus />
      <div className="composer__actions">
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Discard
        </Button>
        <Button variant="primary" icon={Send} loading={sending} disabled={!html.replace(/<[^>]+>/g, '').trim() || !to.trim()} onClick={send}>
          Send
        </Button>
      </div>
    </div>
  );
}

function ComposeSheet({ open, onClose, mailboxes, defaultMailboxId, onSent }: { open: boolean; onClose: () => void; mailboxes: MailboxDto[]; defaultMailboxId: string; onSent: () => void }) {
  const toast = useToast();
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('');
  const [from, setFrom] = useState(defaultMailboxId);
  const [sending, setSending] = useState(false);
  const active = mailboxes.filter((m) => m.status === 'active');

  useEffect(() => {
    if (open) setFrom(defaultMailboxId || active[0]?.id || '');
  }, [open, defaultMailboxId]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    setSending(true);
    try {
      await apiPost('/api/mail/send', { to: to.split(/[\s,;]+/).filter(Boolean), subject, html, mailboxId: from || undefined });
      toast.success('Message sent');
      setTo('');
      setSubject('');
      setHtml('');
      onSent();
      onClose();
    } catch (e) {
      toast.error('Could not send', e instanceof Error ? e.message : undefined);
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      full
      title="New message"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={Send} loading={sending} disabled={!to.trim() || !subject.trim() || !html.replace(/<[^>]+>/g, '').trim()} onClick={send}>
            Send
          </Button>
        </>
      }
    >
      <div className="stack">
        {active.length > 1 && (
          <Field label="From">
            <Select value={from} onChange={(e) => setFrom(e.target.value)} options={active.map((m) => ({ value: m.id, label: m.email }))} />
          </Field>
        )}
        <Field label="To" hint="Separate several addresses with commas.">
          <Input type="email" multiple inputMode="email" autoCapitalize="off" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com" />
        </Field>
        <Field label="Subject">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <RichEditor label="Message" value={html} onChange={setHtml} minHeight={200} />
      </div>
    </Sheet>
  );
}
