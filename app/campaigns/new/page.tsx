'use client';

import '../campaigns.css';
import { AlertTriangle, ArrowLeft, ArrowRight, Mail, Plus, Rocket, Trash2, Upload } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Badge, Button, Card, Chip, EmptyState, Field, FilterChips, Input, PageHeader, SearchInput, Select, Skeleton, Textarea, useToast, formatNumber } from '@/app/ui';
import { ClientApiError, apiPatch, apiPost, invalidate, useApi } from '@/lib/client/api';
import { DAY_LABELS, TIMEZONES } from '@/lib/email/settings';
import { RichEditor } from '@/lib/email/ui/rich-editor';
import { Toggle } from '@/lib/email/ui/toggle';
import { audienceKey, type AudienceRowDto, type CampaignSettingsDto, type MailboxDto, type WorkspaceEmailDto } from '@/lib/email/ui/types';

const STEPS = ['Audience', 'Sequence', 'Settings', 'Review'];
type SeqStep = { subject: string; bodyHtml: string; delayDays: number };
type Filters = { q: string; stage: string; state: string; dm: boolean };

const STARTER: SeqStep[] = [
  {
    subject: 'Cutting water costs at {{company}}',
    bodyHtml:
      '<p>Hi {{first_name|there}},</p><p>I work with multifamily owners and managers in {{state|your area}} on reducing water spend. Most buildings lose 10-20% of their water to leaks and billing errors that nobody notices until the bill arrives.</p><p>Would it be worth a 15-minute call to see what that could look like for {{company|your portfolio}}?</p><p>Thanks,<br>{{sender_name}}</p>',
    delayDays: 0,
  },
  {
    subject: '',
    bodyHtml: '<p>Hi {{first_name|there}},</p><p>Following up in case my note got buried. Happy to send a short example of what we found at a similar property if that is easier than a call.</p><p>{{sender_name}}</p>',
    delayDays: 3,
  },
];

const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim();

export default function NewCampaignPage() {
  return (
    <Suspense fallback={null}>
      <Wizard />
    </Suspense>
  );
}

function Wizard() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const prefill = params.get('companyIds')?.split(',').filter(Boolean) ?? [];

  const [step, setStep] = useState(0);
  // Audience
  const [filters, setFilters] = useState<Filters>({ q: '', stage: '', state: '', dm: false });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [limit, setLimit] = useState(100);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const initialSelect = useRef(false);
  // Sequence
  const [seq, setSeq] = useState<SeqStep[]>(STARTER);
  // Settings
  const [name, setName] = useState('');
  const [mailboxId, setMailboxId] = useState('');
  const [settings, setSettings] = useState<CampaignSettingsDto | null>(null);
  const [address, setAddress] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);
  // Review
  const [previewStep, setPreviewStep] = useState(0);
  const [previewContact, setPreviewContact] = useState('');
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const mailboxes = useApi<{ mailboxes: MailboxDto[] }>('/api/mail/mailboxes', { revalidateOnFocus: false });
  const workspace = useApi<WorkspaceEmailDto>('/api/mail/settings', { revalidateOnFocus: false });
  const active = (mailboxes.data?.mailboxes ?? []).filter((m) => m.status === 'active');

  useEffect(() => {
    if (workspace.data && !settings) {
      setSettings(workspace.data.defaults);
      setAddress(workspace.data.companyAddress ?? '');
    }
  }, [workspace.data, settings]);
  useEffect(() => {
    if (!mailboxId && active[0]) setMailboxId(active[0].id);
  }, [active, mailboxId]);

  // Audience query
  const qs = new URLSearchParams({ limit: String(limit) });
  if (prefill.length) qs.set('companyIds', prefill.join(','));
  if (filters.q) qs.set('q', filters.q);
  if (filters.stage) qs.set('stage', filters.stage);
  if (filters.state) qs.set('state', filters.state);
  if (filters.dm) qs.set('decisionMakersOnly', '1');
  const audience = useApi<{ rows: AudienceRowDto[]; total: number }>(`/api/campaigns/audience?${qs.toString()}`);
  const rows = audience.data?.rows ?? [];
  const total = audience.data?.total ?? 0;
  const blocked = (r: AudienceRowDto) => !!r.suppressed || !!r.unsubscribed_at || !!r.bounced_at;
  const selectable = rows.filter((r) => !blocked(r));

  // Pre-select everything for CRM hand-offs (?companyIds=).
  useEffect(() => {
    if (prefill.length && !initialSelect.current && audience.data) {
      initialSelect.current = true;
      setSelected(new Set(audience.data.rows.filter((r) => !blocked(r)).map(audienceKey)));
      if (audience.data.total > audience.data.rows.length) setAllMatching(true);
    }
  }, [audience.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const pastedCount = useMemo(() => (pasted.match(/[^\s,;<>"']+@[^\s,;<>"']+\.[a-z]{2,}/gi) ?? []).length, [pasted]);
  const recipientCount = (allMatching ? total : selected.size) + pastedCount;

  const toggle = (r: AudienceRowDto) => {
    if (blocked(r)) return;
    setAllMatching(false);
    const next = new Set(selected);
    const k = audienceKey(r);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setSelected(next);
  };
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(audienceKey(r)));
  const toggleAll = () => {
    setAllMatching(false);
    setSelected(allSelected ? new Set() : new Set(selectable.map(audienceKey)));
  };
  const setFilter = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    setFilters({ ...filters, [k]: v });
    setAllMatching(false);
    setSelected(new Set());
  };

  const audiencePayload = () => {
    const isCsv = /(^|\n)\s*(email|e-mail)[,;\t]/i.test(pasted.split('\n')[0] ?? '') && pasted.includes('\n');
    const base: Record<string, unknown> = {};
    if (allMatching) {
      base.filter = { q: filters.q || undefined, stage: filters.stage || undefined, state: filters.state || undefined };
      base.decisionMakersOnly = filters.dm || undefined;
      if (prefill.length) base.companyIds = prefill;
    } else if (selected.size) {
      const rowsSel = rows.filter((r) => selected.has(audienceKey(r)));
      base.contactIds = rowsSel.map((r) => r.contact_id).filter(Boolean);
      const companyOnly = rowsSel.filter((r) => !r.contact_id && r.company_id).map((r) => r.company_id);
      if (companyOnly.length) base.companyIds = companyOnly;
    }
    if (pasted.trim()) {
      if (isCsv) base.csv = pasted;
      else base.emails = [pasted];
    }
    return base;
  };

  const stepsPayload = seq.map((s, i) => ({ subject: s.subject, bodyHtml: s.bodyHtml, delayDays: i === 0 ? 0 : s.delayDays }));

  const stepValid = [recipientCount > 0, seq.every((s, i) => textOf(s.bodyHtml) && (i > 0 || s.subject.trim())), !!settings && !!mailboxId && !!name.trim(), true][step];

  const saveAddress = async () => {
    setSavingAddress(true);
    try {
      await apiPatch('/api/mail/settings', { companyAddress: address });
      await workspace.mutate();
      toast.success('Mailing address saved');
    } finally {
      setSavingAddress(false);
    }
  };

  // Review: preview
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string; missing: string[]; unknown: string[] } | null>(null);
  useEffect(() => {
    if (step !== 3 || !settings) return;
    let cancelled = false;
    setPreview(null);
    apiPost<{ subject: string; html: string; text: string; missing: string[]; unknown: string[] }>('/api/campaigns/preview', {
      steps: seq.map((s) => ({ subject: s.subject, bodyHtml: s.bodyHtml })),
      stepIndex: previewStep,
      mailboxId: mailboxId || null,
      contactId: previewContact || undefined,
      settings,
    })
      .then((p) => !cancelled && setPreview(p))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [step, previewStep, previewContact, seq, settings, mailboxId]);

  const sendTest = async () => {
    setBusy('test');
    try {
      const res = await apiPost<{ to: string }>('/api/campaigns/test', {
        steps: seq.map((s) => ({ subject: s.subject, bodyHtml: s.bodyHtml })),
        stepIndex: previewStep,
        mailboxId,
        to: testTo || undefined,
        contactId: previewContact || undefined,
        settings,
      });
      toast.success('Test email sent', `Check ${res.to}`);
    } catch (e) {
      toast.error('Could not send test', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const create = async (launch: boolean) => {
    if (!settings) return;
    setBusy(launch ? 'launch' : 'draft');
    setProblems([]);
    let id: string | null = null;
    try {
      const created = await apiPost<{ id: string }>('/api/campaigns', { name: name.trim(), mailboxId, settings, steps: stepsPayload, audience: audiencePayload() });
      id = created.id;
      if (launch) {
        try {
          await apiPost(`/api/campaigns/${id}/launch`, {});
          toast.success('Campaign launched', 'Sending starts inside your send window.');
        } catch (e) {
          const issues = e instanceof ClientApiError ? ((e.details as { issues?: { level: string; message: string }[] } | undefined)?.issues ?? []) : [];
          toast.error('Saved as a draft', e instanceof Error ? e.message : undefined);
          setProblems(issues.filter((i) => i.level === 'error').map((i) => i.message));
        }
      } else toast.success('Draft saved');
      await invalidate('/api/campaigns');
      router.push(`/campaigns/${id}`);
    } catch (e) {
      toast.error('Could not create campaign', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const setSetting = <K extends keyof CampaignSettingsDto>(k: K, v: CampaignSettingsDto[K]) => settings && setSettings({ ...settings, [k]: v });
  const mailbox = active.find((m) => m.id === mailboxId);
  const perDay = settings ? Math.min(settings.dailyLimit, mailbox?.daily_limit ?? settings.dailyLimit) : 0;
  const daysNeeded = perDay ? Math.ceil(recipientCount / perDay) : 0;

  return (
    <div className="page page--narrow">
      <PageHeader title="New campaign" back={{ href: '/campaigns', label: 'Campaigns' }} subtitle="Choose who to email, write the sequence, and let Puma send it slowly from your mailbox." />
      <nav className="wiz-steps" aria-label="Progress">
        {STEPS.map((label, i) => (
          <button key={label} type="button" disabled={i > step} className={`wiz-step${i < step ? ' is-done' : ''}${i === step ? ' is-current' : ''}`} onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined}>
            <span className="wiz-step__bar" />
            <span>
              <span className="wiz-step__n">{i + 1}</span> {label}
            </span>
          </button>
        ))}
      </nav>

      {step === 0 && (
        <div className="stack">
          <Card title="Who should get this?" description={prefill.length ? `${prefill.length} compan${prefill.length === 1 ? 'y' : 'ies'} from your CRM are pre-selected.` : 'Pick from your CRM contacts. Only people with an email address appear.'} flush>
            <div className="stack" style={{ padding: '0 16px 12px' }}>
              <SearchInput value={filters.q} onChange={(v) => setFilter('q', v)} debounce={250} placeholder="Search companies or people" />
              <FilterChips
                value={filters.stage}
                onChange={(v) => setFilter('stage', v)}
                options={[{ value: '', label: 'Any stage' }, { value: 'new', label: 'New lead' }, { value: 'qualified', label: 'Qualified' }, { value: 'contacted', label: 'Contacted' }, { value: 'client', label: 'Client' }]}
                aria-label="Stage"
              />
              <div className="row-wrap">
                <Select className="wiz-state" aria-label="State" value={filters.state} onChange={(e) => setFilter('state', e.target.value)} placeholder="Any state" options={['NJ', 'NY', 'PA', 'CT', 'DE', 'MD', 'MA', 'DC']} />
                <Chip selected={filters.dm} onClick={() => setFilter('dm', !filters.dm)}>
                  Decision makers only
                </Chip>
              </div>
            </div>
            <div className="aud-row" style={{ background: 'var(--surface)', cursor: 'default' }}>
              <input type="checkbox" className="ui-check" checked={allSelected || allMatching} onChange={toggleAll} aria-label="Select all shown" />
              <span className="grow text-sm muted">
                {audience.isLoading ? 'Loading…' : `${formatNumber(total)} match · ${selectable.length} shown`}
              </span>
              {total > rows.length && !allMatching && (
                <Button size="sm" variant="ghost" onClick={() => { setAllMatching(true); setSelected(new Set(selectable.map(audienceKey))); }}>
                  Select all {formatNumber(total)}
                </Button>
              )}
              {total > rows.length && limit < 500 && (
                <Button size="sm" variant="ghost" onClick={() => setLimit(500)}>
                  Show more
                </Button>
              )}
            </div>
            <div className="aud-list">
              {audience.isLoading ? (
                <div className="stack" style={{ padding: 16 }}>
                  <Skeleton height={36} />
                  <Skeleton height={36} />
                  <Skeleton height={36} />
                </div>
              ) : rows.length === 0 ? (
                <EmptyState compact icon={Mail} title="No contacts with email match" description="Try clearing filters, or paste addresses below." />
              ) : (
                rows.map((r) => {
                  const k = audienceKey(r);
                  const off = blocked(r);
                  return (
                    <label key={k} className={`aud-row${off ? ' is-disabled' : ''}`}>
                      <input type="checkbox" className="ui-check" checked={!off && (allMatching || selected.has(k))} disabled={off} onChange={() => toggle(r)} />
                      <Avatar name={r.full_name || r.company_name || r.email} size="sm" />
                      <span className="aud-row__main">
                        <span className="aud-row__name">
                          <span>{r.full_name || r.email}</span>
                          {r.is_decision_maker && <Badge tone="accent">Decision maker</Badge>}
                          {off && <Badge tone="warning">{r.suppressed ?? (r.unsubscribed_at ? 'unsubscribed' : 'bounced')}</Badge>}
                        </span>
                        <span className="aud-row__sub">{[r.title, r.company_name, r.state].filter(Boolean).join(' · ') || r.email}</span>
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </Card>

          <Card
            title="Paste emails or CSV"
            description="Add people who are not in the CRM yet."
            actions={
              <Button size="sm" variant="ghost" onClick={() => setPasteOpen((v) => !v)}>
                {pasteOpen ? 'Hide' : 'Add'}
              </Button>
            }
          >
            {pasteOpen && (
              <div className="stack-sm">
                <Textarea rows={6} className="textarea-mono" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={'jane@acme.com\nBob Smith <bob@example.com>\n\nor CSV with columns: email, first_name, last_name, company'} />
                <label className="ui-btn ui-btn--secondary ui-btn--sm" style={{ alignSelf: 'flex-start', cursor: 'pointer' }}>
                  <span className="ui-btn__label">
                    <Upload size={14} /> Upload CSV
                  </span>
                  <input type="file" accept=".csv,text/csv,text/plain" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPasted(await f.text()); }} />
                </label>
                {pastedCount > 0 && <span className="text-sm muted">{pastedCount} address{pastedCount === 1 ? '' : 'es'} found</span>}
              </div>
            )}
          </Card>
        </div>
      )}

      {step === 1 && (
        <div className="stack">
          {seq.map((s, i) => (
            <div key={i}>
              {i > 0 && (
                <div className="seq-wait">
                  <span className="seq-line" style={{ margin: 0, height: 20 }} />
                  <span>Wait</span>
                  <Input inputMode="numeric" size="sm" value={String(s.delayDays)} onChange={(e) => setSeq(seq.map((x, j) => (j === i ? { ...x, delayDays: Math.min(90, Number(e.target.value.replace(/\D/g, '')) || 0) } : x)))} aria-label="Days to wait" />
                  <span>days, then send (skipped if they reply)</span>
                </div>
              )}
              <div className="seq-card" style={i > 0 ? { marginTop: 10 } : undefined}>
                <div className="seq-card__head">
                  <span className="step-row__n">{i + 1}</span>
                  <span className="seq-card__title">{i === 0 ? 'First email' : `Follow-up ${i}`}</span>
                  {i > 0 && (
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setSeq(seq.filter((_, j) => j !== i))}>
                      Remove
                    </Button>
                  )}
                </div>
                <Field label="Subject" hint={i > 0 ? 'Leave empty to reply in the same thread with “Re: …”.' : undefined}>
                  <Input value={s.subject} onChange={(e) => setSeq(seq.map((x, j) => (j === i ? { ...x, subject: e.target.value } : x)))} placeholder={i > 0 ? 'Same thread (Re: …)' : 'Cutting water costs at {{company}}'} />
                </Field>
                <RichEditor value={s.bodyHtml} onChange={(html) => setSeq((cur) => cur.map((x, j) => (j === i ? { ...x, bodyHtml: html } : x)))} mergeTags minHeight={170} label="Message" />
              </div>
            </div>
          ))}
          {seq.length < 6 && (
            <Button icon={Plus} onClick={() => setSeq([...seq, { subject: '', bodyHtml: '<p>Hi {{first_name|there}},</p><p></p>', delayDays: 4 }])}>
              Add follow-up
            </Button>
          )}
          <p className="text-sm subtle">Merge tags such as {'{{first_name|there}}'} use the text after “|” when the value is missing. A signature, your mailing address and an unsubscribe link are added automatically.</p>
        </div>
      )}

      {step === 2 && settings && (
        <div className="stack">
          <Card title="Basics">
            <div className="stack">
              <Field label="Campaign name" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="NJ owners, October outreach" />
              </Field>
              <Field label="Send from" required hint={active.length === 0 ? undefined : `${mailbox?.sent_today ?? 0} sent today · limit ${mailbox?.daily_limit ?? '-'} per day`}>
                {active.length === 0 ? (
                  <div className="note note--warn" style={{ padding: 12, borderRadius: 12, background: 'var(--warning-soft)' }}>
                    No connected account. <a className="link" href="/settings/email">Connect email</a> first.
                  </div>
                ) : (
                  <Select value={mailboxId} onChange={(e) => setMailboxId(e.target.value)} options={active.map((m) => ({ value: m.id, label: m.email }))} />
                )}
              </Field>
              {workspace.data && !workspace.data.companyAddress && (
                <Field label="Business mailing address" required hint="CAN-SPAM requires a physical address in every campaign email.">
                  <div className="row">
                    <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="100 Market St, Newark, NJ 07102" />
                    <Button loading={savingAddress} disabled={address.trim().length < 8} onClick={saveAddress}>Save</Button>
                  </div>
                </Field>
              )}
            </div>
          </Card>
          <Card title="Schedule & throttle" description="Emails are spaced out with random gaps, only inside your send window.">
            <div className="stack">
              <div className="formgrid formgrid--3">
                <Field label="Emails per day">
                  <Input inputMode="numeric" value={String(settings.dailyLimit)} onChange={(e) => setSetting('dailyLimit', Number(e.target.value.replace(/\D/g, '')) || 0)} />
                </Field>
                <Field label="Min gap (sec)">
                  <Input inputMode="numeric" value={String(settings.minDelaySec)} onChange={(e) => setSetting('minDelaySec', Number(e.target.value.replace(/\D/g, '')) || 0)} />
                </Field>
                <Field label="Max gap (sec)">
                  <Input inputMode="numeric" value={String(settings.maxDelaySec)} onChange={(e) => setSetting('maxDelaySec', Number(e.target.value.replace(/\D/g, '')) || 0)} />
                </Field>
                <Field label="Window opens">
                  <Input type="time" value={settings.windowStart} onChange={(e) => setSetting('windowStart', e.target.value)} />
                </Field>
                <Field label="Window closes">
                  <Input type="time" value={settings.windowEnd} onChange={(e) => setSetting('windowEnd', e.target.value)} />
                </Field>
                <Field label="Time zone">
                  <Select value={settings.timezone} onChange={(e) => setSetting('timezone', e.target.value)} options={TIMEZONES.includes(settings.timezone) ? TIMEZONES : [settings.timezone, ...TIMEZONES]} />
                </Field>
              </div>
              <div className="stack-sm">
                <span className="ui-field__label">Send on</span>
                <div className="tz-row">
                  {DAY_LABELS.map((label, i) => (
                    <Chip key={label} selected={settings.sendDays.includes(i + 1)} onClick={() => setSetting('sendDays', settings.sendDays.includes(i + 1) ? settings.sendDays.filter((d) => d !== i + 1) : [...settings.sendDays, i + 1].sort())}>
                      {label}
                    </Chip>
                  ))}
                </div>
              </div>
              <Toggle label="Stop the sequence when someone replies" checked={settings.stopOnReply} onChange={(v) => setSetting('stopOnReply', v)} />
              <Toggle label="Track opens" hint="Adds an invisible pixel." checked={settings.trackOpens} onChange={(v) => setSetting('trackOpens', v)} />
              <Toggle label="Track link clicks" hint="Rewrites links. May lower inbox placement." checked={settings.trackClicks} onChange={(v) => setSetting('trackClicks', v)} />
              <Toggle label="Add my signature" checked={settings.includeSignature} onChange={(v) => setSetting('includeSignature', v)} />
            </div>
          </Card>
        </div>
      )}

      {step === 3 && settings && (
        <div className="stack">
          <div className="review-grid">
            <Stat2 label="Recipients" value={formatNumber(recipientCount)} />
            <Stat2 label="Emails in sequence" value={String(seq.length)} />
            <Stat2 label="Per day" value={String(perDay)} />
            <Stat2 label="First pass takes" value={`${daysNeeded} day${daysNeeded === 1 ? '' : 's'}`} />
          </div>
          {workspace.data && !workspace.data.companyAddress && !address.trim() && (
            <div className="issue issue--error">
              <AlertTriangle size={16} color="var(--danger)" />
              <span>Add your business mailing address in the Settings step (or in Settings &gt; Email) before launching.</span>
            </div>
          )}
          {problems.map((p) => (
            <div key={p} className="issue issue--error">
              <AlertTriangle size={16} color="var(--danger)" />
              <span>{p}</span>
            </div>
          ))}
          <Card title="Preview" description="Exactly what a recipient will see (links are not tracked in previews).">
            <div className="stack">
              <div className="row-wrap">
                {seq.map((_, i) => (
                  <Chip key={i} selected={previewStep === i} onClick={() => setPreviewStep(i)}>
                    Email {i + 1}
                  </Chip>
                ))}
              </div>
              <Select value={previewContact} onChange={(e) => setPreviewContact(e.target.value)} aria-label="Preview as" placeholder="Preview as sample contact (Jordan Rivera)" options={rows.filter((r) => r.contact_id).slice(0, 25).map((r) => ({ value: r.contact_id!, label: `${r.full_name ?? r.email}${r.company_name ? ` · ${r.company_name}` : ''}` }))} />
              {preview ? (
                <>
                  <div className="preview-subject">
                    <span>Subject</span>
                    <strong>{preview.subject || '(empty)'}</strong>
                  </div>
                  {preview.missing.length > 0 && (
                    <div className="issue issue--warning">
                      <AlertTriangle size={16} color="var(--warning)" />
                      <span>No value for {preview.missing.map((m) => `{{${m}}}`).join(', ')} for this contact. Add a fallback like {'{{first_name|there}}'}.</span>
                    </div>
                  )}
                  {preview.unknown.length > 0 && (
                    <div className="issue issue--error">
                      <AlertTriangle size={16} color="var(--danger)" />
                      <span>Unknown merge tag: {preview.unknown.map((m) => `{{${m}}}`).join(', ')}</span>
                    </div>
                  )}
                  <iframe className="preview-frame" title="Email preview" sandbox="allow-same-origin" srcDoc={`<!doctype html><meta charset="utf-8"><base target="_blank"><body style="margin:16px;font-family:Arial,sans-serif">${preview.html}</body>`} style={{ height: 380 }} />
                </>
              ) : (
                <Skeleton height={260} />
              )}
              <div className="row-wrap">
                <Input type="email" placeholder={mailbox?.email ?? 'Send test to…'} value={testTo} onChange={(e) => setTestTo(e.target.value)} aria-label="Send test to" style={{ maxWidth: 260 }} />
                <Button loading={busy === 'test'} disabled={!mailboxId} icon={Mail} onClick={sendTest}>
                  Send test
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      <div className="wiz-foot">
        <div className="wiz-foot__info">{step === 0 ? <><strong>{formatNumber(recipientCount)}</strong> selected</> : <span className="truncate">{name || 'Untitled campaign'}</span>}</div>
        <div className="row">
          {step > 0 && (
            <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          {step < 3 ? (
            <Button variant="primary" iconRight={ArrowRight} disabled={!stepValid} onClick={() => setStep(step + 1)}>
              Next
            </Button>
          ) : (
            <>
              <Button loading={busy === 'draft'} disabled={!!busy} onClick={() => create(false)}>
                Save draft
              </Button>
              <Button variant="primary" icon={Rocket} loading={busy === 'launch'} disabled={!!busy || !mailboxId} onClick={() => create(true)}>
                Launch
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat2({ label, value }: { label: string; value: string }) {
  return (
    <div className="ui-card" style={{ padding: 14 }}>
      <div className="text-xs subtle">{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}
