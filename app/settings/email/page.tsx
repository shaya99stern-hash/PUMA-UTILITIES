'use client';

import './email.css';
import { AlertTriangle, CheckCircle2, ExternalLink, Mail, MoreHorizontal, Plus, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Chip, EmptyState, Field, IconButton, Input, Menu, PageHeader, ProgressBar, Select, Sheet, Skeleton, Textarea, useToast, formatRelative } from '@/app/ui';
import { ClientApiError, apiDelete, apiPatch, apiPost, invalidate, useApi } from '@/lib/client/api';
import { guessPreset, PRESET_LIST, PRESETS, type PresetKey } from '@/lib/email/presets';
import { DAY_LABELS, TIMEZONES } from '@/lib/email/settings';
import { RichEditor } from '@/lib/email/ui/rich-editor';
import { Toggle } from '@/lib/email/ui/toggle';
import type { CampaignSettingsDto, MailboxDto, WorkspaceEmailDto } from '@/lib/email/ui/types';

type ProviderInfo = { google: boolean; microsoft: boolean; redirectUris: { google: string; microsoft: string }; devTransport: boolean };
type Step = 'pick' | 'details';
type TestOutcome = { smtp?: { ok: boolean; error?: string }; imap?: { ok: boolean; error?: string }; error?: string } | null;

const PROVIDER_LOGO: Record<PresetKey, string> = { gmail: 'G', outlook: 'O', icloud: 'iC', yahoo: 'Y!', zoho: 'Z', godaddy: 'Go', fastmail: 'F', custom: '@' };
const TILES: { key: PresetKey; name: string; sub: string }[] = [
  { key: 'gmail', name: 'Gmail', sub: 'Google or Workspace' },
  { key: 'outlook', name: 'Outlook', sub: 'Microsoft 365 / Outlook.com' },
  { key: 'icloud', name: 'iCloud', sub: 'Apple Mail' },
  { key: 'yahoo', name: 'Yahoo', sub: 'Yahoo Mail' },
  { key: 'custom', name: 'Other', sub: 'IMAP / SMTP' },
];

function providerLabel(m: MailboxDto) {
  if (m.provider === 'gmail') return 'Google sign-in';
  if (m.provider === 'microsoft') return 'Microsoft sign-in';
  const host = m.smtp_host ?? '';
  const hit = PRESET_LIST.find((p) => p.smtp.host && p.smtp.host === host);
  return hit && hit.key !== 'custom' ? hit.label : 'IMAP / SMTP';
}

export default function EmailSettingsPage() {
  return (
    <Suspense fallback={null}>
      <EmailSettings />
    </Suspense>
  );
}

function EmailSettings() {
  const toast = useToast();
  const router = useRouter();
  const search = useSearchParams();
  const { data, isLoading, mutate } = useApi<{ mailboxes: MailboxDto[] }>('/api/mail/mailboxes');
  const providers = useApi<ProviderInfo>('/api/mail/providers', { revalidateOnFocus: false });
  const [connectOpen, setConnectOpen] = useState(false);
  const [editing, setEditing] = useState<MailboxDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Result of the OAuth round trip.
  useEffect(() => {
    const connected = search.get('connected');
    const error = search.get('error');
    if (connected) {
      toast.success('Email connected', connected);
      void mutate();
    } else if (error) toast.error('Could not connect', error);
    if (connected || error) router.replace('/settings/email');
  }, [search, router, toast, mutate]);

  const mailboxes = data?.mailboxes ?? [];

  const act = async (m: MailboxDto, kind: 'test' | 'sync' | 'delete') => {
    setBusy(`${kind}:${m.id}`);
    try {
      if (kind === 'test') {
        const res = await apiPost<{ test: { ok: boolean; error?: string } }>(`/api/mail/mailboxes/${m.id}/test`);
        if (res.test.ok) toast.success('Connection works', m.email);
        else toast.error('Connection failed', res.test.error);
      } else if (kind === 'sync') {
        const res = await apiPost<{ result: { fetched: number; stored: number; replies: number; error?: string } }>(`/api/mail/mailboxes/${m.id}/sync`);
        if (res.result.error) toast.error('Sync failed', res.result.error);
        else toast.success(`Synced ${res.result.stored} new message${res.result.stored === 1 ? '' : 's'}`, res.result.replies ? `${res.result.replies} campaign repl${res.result.replies === 1 ? 'y' : 'ies'}` : undefined);
        void invalidate('/api/mail/messages');
      } else {
        if (!window.confirm(`Remove ${m.email}? Synced messages from this account are deleted from Puma, and running campaigns that use it are paused.`)) return;
        await apiDelete(`/api/mail/mailboxes/${m.id}`);
        toast.success('Account removed');
      }
      await mutate();
    } catch (e) {
      toast.error('Something went wrong', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page page--narrow">
      <PageHeader
        title="Email accounts & sending"
        subtitle="Connect your own mailbox to read and reply inside Puma, and to send campaigns."
        back={{ href: '/settings', label: 'Settings' }}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setConnectOpen(true)}>
            Connect email
          </Button>
        }
      />

      <div className="stack-lg">
        <Card title="Connected accounts" flush>
          {isLoading ? (
            <div className="stack" style={{ padding: 16 }}>
              <Skeleton height={44} />
              <Skeleton height={44} />
            </div>
          ) : mailboxes.length === 0 ? (
            <EmptyState
              icon={Mail}
              title="No email connected yet"
              description="Connect Gmail, Outlook, iCloud or any IMAP mailbox to read replies here and send outreach from your own address."
              actions={
                <Button variant="primary" icon={Plus} onClick={() => setConnectOpen(true)}>
                  Connect email
                </Button>
              }
            />
          ) : (
            <div>
              {mailboxes.map((m) => (
                <div className="mbx" key={m.id}>
                  <Avatarish email={m.email} />
                  <div className="mbx__main">
                    <div className="mbx__top">
                      <span className="mbx__email">{m.email}</span>
                      <Badge tone={m.status === 'active' ? 'success' : m.status === 'error' ? 'danger' : 'neutral'} dot>
                        {m.status === 'active' ? 'Connected' : m.status === 'error' ? 'Needs attention' : 'Disconnected'}
                      </Badge>
                    </div>
                    <span className="mbx__sub">
                      {providerLabel(m)} · {m.last_sync_at ? `synced ${formatRelative(m.last_sync_at)}` : 'not synced yet'}
                    </span>
                    {m.last_error && <span className="mbx__err">{m.last_error}</span>}
                  </div>
                  <div className="mbx__meter">
                    <ProgressBar size="sm" value={Math.min(100, (m.sent_today / Math.max(1, m.daily_limit)) * 100)} label={<span className="subtle text-xs">Sent today</span>} valueLabel={<span className="text-xs">{m.sent_today} / {m.daily_limit}</span>} />
                  </div>
                  <IconButton icon={RefreshCw} label="Sync now" variant="ghost" disabled={busy === `sync:${m.id}`} onClick={() => act(m, 'sync')} className={busy === `sync:${m.id}` ? 'is-spinning' : undefined} />
                  <Menu
                    trigger={<IconButton icon={MoreHorizontal} label="More" />}
                    items={[
                      { label: 'Edit signature & limits', onSelect: () => setEditing(m) },
                      { label: 'Test connection', onSelect: () => act(m, 'test') },
                      { separator: true },
                      { label: 'Remove account', danger: true, onSelect: () => act(m, 'delete') },
                    ]}
                  />
                </div>
              ))}
            </div>
          )}
        </Card>

        <SendingSettings />

        {providers.data && !providers.data.google && !providers.data.microsoft && <OAuthHelp info={providers.data} />}
      </div>

      <ConnectSheet open={connectOpen} onClose={() => setConnectOpen(false)} providers={providers.data} onConnected={() => void mutate()} />
      <EditSheet mailbox={editing} onClose={() => setEditing(null)} onSaved={() => void mutate()} />
    </div>
  );
}

function Avatarish({ email }: { email: string }) {
  return (
    <span className="tile__logo" style={{ width: 38, height: 38, flex: 'none' }} aria-hidden>
      {email.slice(0, 1).toUpperCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Connect sheet
// ---------------------------------------------------------------------------

function ConnectSheet({ open, onClose, providers, onConnected }: { open: boolean; onClose: () => void; providers?: ProviderInfo; onConnected: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState<Step>('pick');
  const [preset, setPreset] = useState<PresetKey>('gmail');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [smtp, setSmtp] = useState({ host: '', port: '587', secure: false });
  const [imap, setImap] = useState({ host: '', port: '993', secure: true });
  const [limit, setLimit] = useState('150');
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<TestOutcome>(null);
  const [showServer, setShowServer] = useState(false);
  // "Any email": the server detects SMTP/IMAP settings from the address.
  const [auto, setAuto] = useState(false);

  useEffect(() => {
    if (open) {
      setStep('pick');
      setOutcome(null);
      setPassword('');
    }
  }, [open]);

  const info = PRESETS[preset];
  const pickAuto = () => {
    setAuto(true);
    setPreset('custom');
    setShowServer(false);
    setOutcome(null);
    setStep('details');
  };
  const pick = (key: PresetKey) => {
    setAuto(false);
    setPreset(key);
    setSmtp({ host: PRESETS[key].smtp.host, port: String(PRESETS[key].smtp.port), secure: PRESETS[key].smtp.secure });
    setImap({ host: PRESETS[key].imap.host, port: String(PRESETS[key].imap.port), secure: PRESETS[key].imap.secure });
    setShowServer(key === 'custom');
    setOutcome(null);
    setStep('details');
  };

  const oauth = preset === 'gmail' && providers?.google ? 'google' : preset === 'outlook' && providers?.microsoft ? 'microsoft' : null;

  const submit = async () => {
    setSaving(true);
    setOutcome(null);
    try {
      const manual = showServer || (!auto && preset === 'custom');
      const res = await apiPost<{ warning?: string; detected?: { source: string } }>('/api/mail/mailboxes', {
        email,
        displayName: name || undefined,
        preset: auto ? 'auto' : preset,
        username: username || undefined,
        password,
        smtp: manual && smtp.host ? { host: smtp.host, port: Number(smtp.port), secure: smtp.secure } : undefined,
        imap: manual && imap.host ? { host: imap.host, port: Number(imap.port), secure: imap.secure } : undefined,
        dailyLimit: Number(limit) || undefined,
      });
      if (res.warning) toast.info('Connected for sending', res.warning);
      else toast.success('Email connected', res.detected ? `${email} · ${res.detected.source}` : email);
      await invalidate('/api/mail');
      onConnected();
      setPassword('');
      onClose();
    } catch (e) {
      if (e instanceof ClientApiError) {
        const d = e.details as { smtp?: { ok: boolean; error?: string }; imap?: { ok: boolean; error?: string } } | undefined;
        setOutcome({ smtp: d?.smtp, imap: d?.imap, error: e.message });
      } else setOutcome({ error: 'Could not reach the server.' });
    } finally {
      setSaving(false);
    }
  };

  const valid = email.includes('@') && password.length > 0 && (auto || preset !== 'custom' || !!smtp.host);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      title={step === 'pick' ? 'Connect email' : auto ? 'Connect any email' : `Connect ${info.label}`}
      description={step === 'pick' ? 'Choose where your email lives. Passwords are encrypted and never shown again.' : undefined}
      footer={
        step === 'details' ? (
          <>
            <Button variant="ghost" onClick={() => setStep('pick')}>
              Back
            </Button>
            <Button variant="primary" loading={saving} disabled={!valid} onClick={submit}>
              Test & connect
            </Button>
          </>
        ) : undefined
      }
    >
      {step === 'pick' ? (
        <div className="stack">
          {(providers?.google || providers?.microsoft) && (
            <div className="stack-sm">
              <span className="section-title">Sign in with your provider</span>
              <div className="row-wrap">
                {providers.google && (
                  <Button variant="primary" href="/api/oauth/google/start?return=/settings/email" icon={ShieldCheck}>
                    Continue with Google
                  </Button>
                )}
                {providers.microsoft && (
                  <Button variant="primary" href="/api/oauth/microsoft/start?return=/settings/email" icon={ShieldCheck}>
                    Continue with Microsoft
                  </Button>
                )}
              </div>
              <p className="text-sm subtle">Recommended: no password to paste, and you can revoke access any time from your Google or Microsoft account.</p>
            </div>
          )}
          <button type="button" className="tile tile--wide" onClick={pickAuto}>
            <span className="tile__logo"><Mail size={20} /></span>
            <span className="tile__name">Any email address</span>
            <span className="tile__sub">Enter your address and password. Puma finds the mail servers for you (work domains, Gmail, Outlook, iCloud, Yahoo and more).</span>
          </button>
          <span className="section-title">{providers?.google || providers?.microsoft ? 'Or pick your provider (app password)' : 'Or pick your provider'}</span>
          <div className="tiles">
            {TILES.map((t) => (
              <button key={t.key} type="button" className="tile" aria-pressed={preset === t.key && step === 'pick' ? undefined : undefined} onClick={() => pick(t.key)}>
                <span className="tile__logo">{PROVIDER_LOGO[t.key]}</span>
                <span className="tile__name">{t.name}</span>
                <span className="tile__sub">{t.sub}</span>
              </button>
            ))}
          </div>
          <div className="row-wrap">
            {PRESET_LIST.filter((p) => ['zoho', 'godaddy', 'fastmail'].includes(p.key)).map((p) => (
              <Chip key={p.key} onClick={() => pick(p.key)}>
                {p.label}
              </Chip>
            ))}
          </div>
          {providers?.devTransport && <div className="note note--warn">Development mode: mail is not actually sent or received (PUMA_EMAIL_TRANSPORT=json).</div>}
        </div>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) void submit();
          }}
        >
          {oauth && (
            <div className="note note--ok">
              <strong>Easier:</strong> <a href={`/api/oauth/${oauth}/start?return=/settings/email`}>Continue with {oauth === 'google' ? 'Google' : 'Microsoft'}</a> instead of using a password.
            </div>
          )}
          {auto && (
            <div className="note">
              Puma detects your mail servers automatically. If your provider uses two-step verification (Gmail, Outlook.com, iCloud, Yahoo), use an
              app password instead of your normal password. If reading your inbox is not available, the account still connects for sending.
            </div>
          )}
          {!auto && info.appPassword && (
            <div className="note">
              <div className="strong" style={{ color: 'var(--text)', marginBottom: 8 }}>
                {info.label} needs an app password
              </div>
              <ol className="steps">
                {info.steps.map((s) => (
                  <li key={s}>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
              {info.appPasswordUrl && (
                <div style={{ marginTop: 10 }}>
                  <Button size="sm" variant="secondary" href={info.appPasswordUrl} external iconRight={ExternalLink}>
                    Open {info.key === 'gmail' ? 'myaccount.google.com/apppasswords' : 'the app password page'}
                  </Button>
                </div>
              )}
              {info.note && <p className="text-sm" style={{ marginTop: 10 }}>{info.note}</p>}
            </div>
          )}
          {!auto && !info.appPassword && (
            <ol className="steps">
              {info.steps.map((s) => (
                <li key={s}>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          )}

          <Field label="Email address" required>
            <Input
              type="email"
              inputMode="email"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (!auto && preset === 'custom' && !smtp.host) {
                  const guess = guessPreset(e.target.value);
                  if (guess !== 'custom') pick(guess);
                }
              }}
            />
          </Field>
          <Field label="Your name" hint="Shown as the sender name on outgoing email.">
            <Input placeholder="Alex Rivera" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
          <Field label={auto ? 'Password or app password' : info.appPassword ? 'App password' : 'Password'} required hint={!auto && info.appPassword ? 'Paste the 16-character app password. Spaces are fine.' : undefined}>
            <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={info.appPassword ? 'abcd efgh ijkl mnop' : undefined} />
          </Field>

          {(auto || preset !== 'custom') && (
            <button type="button" className="link text-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowServer((v) => !v)}>
              {showServer ? 'Hide server settings' : 'Server settings'}
            </button>
          )}
          {((!auto && preset === 'custom') || showServer) && (
            <div className="stack">
              <Field label="Login name" hint="Usually your full email address. Leave blank to use it.">
                <Input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="off" />
              </Field>
              <div className="formgrid formgrid--2">
                <Field label="SMTP server (sending)" required>
                  <Input value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} placeholder="smtp.example.com" autoCapitalize="off" />
                </Field>
                <div className="formgrid formgrid--2">
                  <Field label="Port">
                    <Input inputMode="numeric" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: e.target.value, secure: e.target.value === '465' })} />
                  </Field>
                  <Field label="Security">
                    <Select value={smtp.secure ? 'ssl' : 'starttls'} onChange={(e) => setSmtp({ ...smtp, secure: e.target.value === 'ssl' })} options={[{ value: 'ssl', label: 'SSL (465)' }, { value: 'starttls', label: 'STARTTLS (587)' }]} />
                  </Field>
                </div>
                <Field label="IMAP server (reading)" hint="Optional. Leave blank to connect for sending only.">
                  <Input value={imap.host} onChange={(e) => setImap({ ...imap, host: e.target.value })} placeholder="imap.example.com" autoCapitalize="off" />
                </Field>
                <Field label="Port">
                  <Input inputMode="numeric" value={imap.port} onChange={(e) => setImap({ ...imap, port: e.target.value })} />
                </Field>
              </div>
            </div>
          )}

          <Field label="Daily sending limit" hint="Campaigns never send more than this from the account per day. Gmail allows about 500 a day; start lower (50-150) on a new account.">
            <Input inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ''))} />
          </Field>

          {outcome && (
            <div className="note note--danger" role="alert">
              <div className="stack-sm">
                <span className="strong">Could not connect</span>
                {outcome.smtp && (
                  <span className="testrow">
                    {outcome.smtp.ok ? <CheckCircle2 size={16} color="var(--success)" /> : <XCircle size={16} color="var(--danger)" />}
                    <span>Sending (SMTP){outcome.smtp.ok ? ' works' : `: ${outcome.smtp.error}`}</span>
                  </span>
                )}
                {outcome.imap && (
                  <span className="testrow">
                    {outcome.imap.ok ? <CheckCircle2 size={16} color="var(--success)" /> : <XCircle size={16} color="var(--danger)" />}
                    <span>Reading (IMAP){outcome.imap.ok ? ' works' : `: ${outcome.imap.error}`}</span>
                  </span>
                )}
                {!outcome.smtp && !outcome.imap && <span>{outcome.error}</span>}
              </div>
            </div>
          )}
          <button type="submit" hidden />
        </form>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Edit sheet (signature, limits, password)
// ---------------------------------------------------------------------------

function EditSheet({ mailbox, onClose, onSaved }: { mailbox: MailboxDto | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [limit, setLimit] = useState('150');
  const [signature, setSignature] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mailbox) {
      setName(mailbox.display_name ?? '');
      setLimit(String(mailbox.daily_limit));
      setSignature(mailbox.signature_html ?? '');
      setPassword('');
      setError(null);
    }
  }, [mailbox]);

  const save = async () => {
    if (!mailbox) return;
    setSaving(true);
    setError(null);
    try {
      await apiPatch(`/api/mail/mailboxes/${mailbox.id}`, {
        displayName: name || null,
        dailyLimit: Number(limit) || mailbox.daily_limit,
        signatureHtml: signature || null,
        ...(password ? { password } : {}),
      });
      toast.success('Saved');
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={!!mailbox}
      onClose={onClose}
      size="lg"
      title={mailbox?.email ?? ''}
      description="Signature, sender name and daily limit."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Sender name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Rivera" />
        </Field>
        <Field label="Daily sending limit" hint={`${mailbox?.sent_today ?? 0} sent in the last 24 hours.`}>
          <Input inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <div>
          <RichEditor label="Signature" value={signature} onChange={setSignature} minHeight={110} placeholder="Alex Rivera · Puma Utilities · (555) 123-4567" compact />
          <p className="text-sm subtle" style={{ marginTop: 6 }}>Added to the end of replies and campaign emails.</p>
        </div>
        {mailbox?.provider === 'smtp_imap' && (
          <Field label="Replace password" hint="Only fill this in if the password or app password changed. The connection is tested before saving.">
            <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        {error && <div className="note note--danger">{error}</div>}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Sending defaults + CAN-SPAM identity
// ---------------------------------------------------------------------------

function SendingSettings() {
  const toast = useToast();
  const { data, mutate } = useApi<WorkspaceEmailDto>('/api/mail/settings', { revalidateOnFocus: false });
  const [form, setForm] = useState<CampaignSettingsDto | null>(null);
  const [address, setAddress] = useState('');
  const [company, setCompany] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setForm(data.defaults);
      setAddress(data.companyAddress ?? '');
      setCompany(data.companyName);
    }
  }, [data]);

  const dirty = useMemo(
    () => !!data && !!form && (JSON.stringify(form) !== JSON.stringify(data.defaults) || address !== (data.companyAddress ?? '') || company !== data.companyName),
    [data, form, address, company],
  );

  if (!form) {
    return (
      <Card title="Sending defaults">
        <Skeleton height={120} />
      </Card>
    );
  }
  const set = <K extends keyof CampaignSettingsDto>(key: K, value: CampaignSettingsDto[K]) => setForm({ ...form, [key]: value });
  const toggleDay = (d: number) => set('sendDays', form.sendDays.includes(d) ? form.sendDays.filter((x) => x !== d) : [...form.sendDays, d].sort());

  const save = async () => {
    setSaving(true);
    try {
      const next = await apiPatch<WorkspaceEmailDto>('/api/mail/settings', { companyAddress: address, companyName: company, defaults: form });
      await mutate(next, { revalidate: false });
      toast.success('Sending settings saved');
    } catch (e) {
      toast.error('Could not save', e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card
        title="Sender identity"
        description="Shown in the footer of campaign emails next to the unsubscribe link. US CAN-SPAM rules require it for marketing email."
      >
        <div className="stack">
          {!address.trim() && (
            <div className="note note--warn" role="status">
              <AlertTriangle size={16} style={{ display: 'inline', verticalAlign: '-3px', marginRight: 6 }} />
              No mailing address yet. Campaigns can still send, but add one (a P.O. box or virtual mailbox works) before real outreach.
            </div>
          )}
          <Field label="Business name">
            <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Puma Utilities LLC" />
          </Field>
          <Field label="Physical mailing address" hint="Street address or registered PO box, city, state and ZIP.">
            <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="100 Market St, Suite 4, Newark, NJ 07102" />
          </Field>
        </div>
      </Card>

      <Card title="Campaign sending defaults" description="New campaigns start with these. You can change them per campaign.">
        <div className="stack">
          <div className="formgrid formgrid--3">
            <Field label="Emails per day" hint="Also capped by each account's limit.">
              <Input inputMode="numeric" value={String(form.dailyLimit)} onChange={(e) => set('dailyLimit', Number(e.target.value.replace(/\D/g, '')) || 0)} />
            </Field>
            <Field label="Min gap (seconds)">
              <Input inputMode="numeric" value={String(form.minDelaySec)} onChange={(e) => set('minDelaySec', Number(e.target.value.replace(/\D/g, '')) || 0)} />
            </Field>
            <Field label="Max gap (seconds)">
              <Input inputMode="numeric" value={String(form.maxDelaySec)} onChange={(e) => set('maxDelaySec', Number(e.target.value.replace(/\D/g, '')) || 0)} />
            </Field>
          </div>
          <div className="formgrid formgrid--3">
            <Field label="Window opens">
              <Input type="time" value={form.windowStart} onChange={(e) => set('windowStart', e.target.value)} />
            </Field>
            <Field label="Window closes">
              <Input type="time" value={form.windowEnd} onChange={(e) => set('windowEnd', e.target.value)} />
            </Field>
            <Field label="Time zone">
              <Select value={form.timezone} onChange={(e) => set('timezone', e.target.value)} options={TIMEZONES.includes(form.timezone) ? TIMEZONES : [form.timezone, ...TIMEZONES]} />
            </Field>
          </div>
          <div className="stack-sm">
            <span className="ui-field__label">Send on</span>
            <div className="daychips">
              {DAY_LABELS.map((label, i) => (
                <Chip key={label} selected={form.sendDays.includes(i + 1)} onClick={() => toggleDay(i + 1)}>
                  {label}
                </Chip>
              ))}
            </div>
          </div>
          <Toggle label="Track opens" hint="Adds a tiny invisible image. Apple Mail and some clients load it automatically, so counts run high." checked={form.trackOpens} onChange={(v) => set('trackOpens', v)} />
          <Toggle label="Track link clicks" hint="Rewrites links through your app. Can reduce inbox placement on new sending domains." checked={form.trackClicks} onChange={(v) => set('trackClicks', v)} />
          <Toggle label="Stop the sequence when someone replies" checked={form.stopOnReply} onChange={(v) => set('stopOnReply', v)} />
          <Toggle label="Add my signature to campaign emails" checked={form.includeSignature} onChange={(v) => set('includeSignature', v)} />
        </div>
      </Card>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button variant="primary" loading={saving} disabled={!dirty} onClick={save}>
          Save changes
        </Button>
      </div>
    </>
  );
}

function OAuthHelp({ info }: { info: ProviderInfo }) {
  return (
    <Card title="One-click sign-in (optional)" description="Let people connect Google or Microsoft without an app password. Needs a one-time setup by an admin.">
      <details>
        <summary className="link text-sm" style={{ cursor: 'pointer' }}>
          Show setup steps
        </summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="stack-sm">
            <strong>Google</strong>
            <ol className="steps">
              <li><span>In Google Cloud Console create an OAuth client (type Web application) and enable the Gmail API.</span></li>
              <li><span>Add this redirect URI: <span className="code">{info.redirectUris.google}</span></span></li>
              <li><span>Set <span className="code">GOOGLE_CLIENT_ID</span> and <span className="code">GOOGLE_CLIENT_SECRET</span> in your environment and redeploy.</span></li>
            </ol>
          </div>
          <div className="stack-sm">
            <strong>Microsoft</strong>
            <ol className="steps">
              <li><span>In Azure, register an app (accounts in any organizational directory and personal accounts).</span></li>
              <li><span>Add the redirect URI: <span className="code">{info.redirectUris.microsoft}</span> and the delegated permissions Mail.Send, Mail.Read, User.Read, offline_access.</span></li>
              <li><span>Set <span className="code">MICROSOFT_CLIENT_ID</span> and <span className="code">MICROSOFT_CLIENT_SECRET</span> in your environment and redeploy.</span></li>
            </ol>
          </div>
        </div>
      </details>
    </Card>
  );
}
