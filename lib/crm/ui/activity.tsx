'use client';

import './crm.css';
import { ArrowRightLeft, Calendar, CheckCircle2, Clock, Info, Mail, Megaphone, Mic, MicOff, Phone, Send, Sparkles, StickyNote, Trash2, Users } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Chip, EmptyState, IconButton, Select, Skeleton, Textarea, Timeline, useToast, type TimelineItem } from '@/app/ui';
import { apiDelete, apiPatch, apiPost, invalidate, useApi, ClientApiError } from '@/lib/client/api';
import { fmtDate, isOverdue, relTime } from '../format';
import { TASK_TYPE_LABELS, type ActivityListRow, type ActivityType, type ContactRow, type TaskListRow, type TaskRow } from '../types';
import { errMsg } from './common';

const TYPE_ICON: Record<ActivityType, typeof StickyNote> = {
  note: StickyNote, voice_note: Mic, call: Phone, meeting: Users, email_out: Send, email_in: Mail, stage_change: ArrowRightLeft,
  task_done: CheckCircle2, research: Sparkles, campaign: Megaphone, system: Info,
};
const TYPE_TONE: Partial<Record<ActivityType, TimelineItem['tone']>> = {
  call: 'info', meeting: 'accent', email_out: 'info', email_in: 'success', stage_change: 'warning', task_done: 'success', research: 'accent', voice_note: 'accent',
};
const TYPE_LABEL: Record<ActivityType, string> = {
  note: 'Note', voice_note: 'Voice note', call: 'Call', meeting: 'Meeting', email_out: 'Email sent', email_in: 'Email received', stage_change: 'Stage change',
  task_done: 'Task completed', research: 'Research', campaign: 'Campaign', system: 'Activity',
};

/* --------------------------- dictation ----------------------------------- */

type SpeechRec = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void;
};

/** Voice dictation: browser SpeechRecognition when available, otherwise record audio and POST to /api/transcribe. */
export function useDictation(onText: (text: string) => void) {
  const toast = useToast();
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const rec = useRef<SpeechRec | null>(null);
  const media = useRef<MediaRecorder | null>(null);
  const cb = useRef(onText);
  cb.current = onText;

  const supported = typeof window !== 'undefined' && (!!(window as unknown as Record<string, unknown>).SpeechRecognition || !!(window as unknown as Record<string, unknown>).webkitSpeechRecognition || (!!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'));

  const stop = useCallback(() => {
    rec.current?.stop();
    if (media.current && media.current.state !== 'inactive') media.current.stop();
  }, []);

  const start = useCallback(async () => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (Ctor) {
      const r = new Ctor();
      r.lang = navigator.language || 'en-US';
      r.continuous = true;
      r.interimResults = false;
      r.onresult = (e) => {
        let text = '';
        for (let i = e.resultIndex; i < e.results.length; i += 1) if (e.results[i].isFinal) text += e.results[i][0].transcript;
        if (text.trim()) cb.current(text.trim());
      };
      r.onerror = (e) => {
        setListening(false);
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast.error('Microphone blocked', 'Allow microphone access in your browser settings to dictate notes.');
        else if (e.error && e.error !== 'no-speech' && e.error !== 'aborted') toast.error('Dictation stopped', e.error);
      };
      r.onend = () => setListening(false);
      rec.current = r;
      try { r.start(); setListening(true); } catch { setListening(false); }
      return;
    }
    // Fallback: record and transcribe on the server.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const mr = new MediaRecorder(stream);
      media.current = mr;
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setListening(false);
        if (!chunks.length) return;
        setTranscribing(true);
        try {
          const form = new FormData();
          form.append('audio', new File(chunks, 'puma-voice.webm', { type: mr.mimeType || 'audio/webm' }));
          const res = await fetch('/api/transcribe', { method: 'POST', body: form });
          const data = (await res.json().catch(() => ({}))) as { transcript?: string; error?: string };
          if (res.status === 501) toast.error('Voice transcription is not set up', 'Type your note instead, or configure transcription in Settings.');
          else if (!res.ok) toast.error('Could not transcribe that recording');
          else if (data.transcript) cb.current(data.transcript);
        } catch { toast.error('Could not transcribe that recording'); } finally { setTranscribing(false); }
      };
      mr.start();
      setListening(true);
    } catch {
      toast.error('Microphone unavailable', 'Allow microphone access to dictate notes.');
    }
  }, [toast]);

  useEffect(() => () => { rec.current?.stop(); if (media.current?.state === 'recording') media.current.stop(); }, []);
  return { supported, listening, transcribing, start, stop };
}

/* --------------------------- composer ------------------------------------ */

const COMPOSER_TYPES = [
  { v: 'note', label: 'Note', icon: StickyNote },
  { v: 'call', label: 'Call', icon: Phone },
  { v: 'meeting', label: 'Meeting', icon: Calendar },
] as const;

export function ActivityComposer({ companyId, contactId, propertyId, contacts, onLogged, placeholder }: {
  companyId?: string | null; contactId?: string | null; propertyId?: string | null; contacts?: Array<Pick<ContactRow, 'id' | 'full_name'>>; onLogged?: () => void; placeholder?: string;
}) {
  const toast = useToast();
  const [type, setType] = useState<'note' | 'call' | 'meeting'>('note');
  const [body, setBody] = useState('');
  const [contact, setContact] = useState(contactId ?? '');
  const [voice, setVoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const dictation = useDictation((text) => { setVoice(true); setBody((b) => (b ? `${b.replace(/\s+$/, '')} ${text}` : text)); });

  const submit = async () => {
    if (!body.trim()) return;
    if (dictation.listening) dictation.stop();
    setBusy(true);
    try {
      await apiPost('/api/activities', {
        company_id: companyId ?? null, contact_id: contact || contactId || null, property_id: propertyId ?? null,
        type: type === 'note' && voice ? 'voice_note' : type, body: body.trim(),
      });
      setBody(''); setVoice(false);
      toast.success(type === 'call' ? 'Call logged' : type === 'meeting' ? 'Meeting logged' : 'Note saved');
      void invalidate('/api/activities');
      void invalidate('/api/companies');
      void invalidate('/api/contacts');
      void invalidate('/api/properties');
      void invalidate('/api/dashboard');
      onLogged?.();
    } catch (e) { toast.error('Could not save', errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <div className="crm-composer">
      <div className="crm-composer__types" role="group" aria-label="Activity type">
        {COMPOSER_TYPES.map((t) => <Chip key={t.v} icon={t.icon} selected={type === t.v} onClick={() => setType(t.v)}>{t.label}</Chip>)}
      </div>
      <Textarea
        value={body} rows={3} onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder ?? (type === 'call' ? 'What did you discuss on the call?' : type === 'meeting' ? 'Meeting notes, attendees, next steps…' : 'Write a note, or tap the mic to dictate…')}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void submit(); } }}
      />
      <div className="crm-composer__foot">
        <div className="row">
          {dictation.supported && (
            <IconButton
              icon={dictation.listening ? MicOff : Mic} variant="secondary" className={dictation.listening ? 'crm-mic--live' : undefined}
              label={dictation.listening ? 'Stop dictation' : dictation.transcribing ? 'Transcribing…' : 'Dictate'} disabled={dictation.transcribing}
              onClick={() => (dictation.listening ? dictation.stop() : void dictation.start())}
            />
          )}
          {dictation.listening && <span className="text-sm muted">Listening…</span>}
          {dictation.transcribing && <span className="text-sm muted">Transcribing…</span>}
          {contacts && contacts.length > 0 && !contactId && (
            <Select value={contact} onChange={(e) => setContact(e.target.value)} placeholder="With… (optional)" options={contacts.map((c) => ({ value: c.id, label: c.full_name }))} style={{ maxWidth: 190 }} />
          )}
        </div>
        <Button variant="primary" onClick={submit} loading={busy} disabled={!body.trim()}>
          {type === 'call' ? 'Log call' : type === 'meeting' ? 'Log meeting' : 'Save note'}
        </Button>
      </div>
    </div>
  );
}

/* --------------------------- timeline ------------------------------------ */

const FILTERS = [
  { v: 'all', label: 'All' },
  { v: 'notes', label: 'Notes', types: ['note', 'voice_note'] },
  { v: 'calls', label: 'Calls & meetings', types: ['call', 'meeting'] },
  { v: 'email', label: 'Email', types: ['email_out', 'email_in', 'campaign'] },
  { v: 'pipeline', label: 'Pipeline', types: ['stage_change', 'task_done', 'research', 'system'] },
] as const;

export function ActivityFeed({ items, loading, onChanged, showCompany }: { items: ActivityListRow[] | undefined; loading?: boolean; onChanged?: () => void; showCompany?: boolean }) {
  const toast = useToast();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['v']>('all');
  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.v === filter);
    if (!items) return [];
    return !f || !('types' in f) ? items : items.filter((a) => (f.types as readonly string[]).includes(a.type));
  }, [items, filter]);

  const remove = async (id: string) => {
    try {
      await apiDelete(`/api/activities/${id}`);
      toast.success('Deleted');
      void invalidate('/api/activities');
      onChanged?.();
    } catch (e) { toast.error('Could not delete', errMsg(e)); }
  };

  if (loading && !items) {
    return <div className="stack">{[0, 1, 2].map((i) => <div key={i} className="row" style={{ alignItems: 'flex-start', gap: 12 }}><Skeleton width={28} height={28} radius={14} /><div className="grow stack-sm"><Skeleton width="40%" /><Skeleton lines={2} /></div></div>)}</div>;
  }
  const timeline: TimelineItem[] = shown.map((a) => {
    const Icon = TYPE_ICON[a.type] ?? Info;
    const manual = ['note', 'voice_note', 'call', 'meeting'].includes(a.type);
    return {
      id: a.id,
      icon: <Icon size={14} />,
      tone: TYPE_TONE[a.type],
      title: a.subject && !manual ? a.subject : TYPE_LABEL[a.type] ?? 'Activity',
      time: <span title={fmtDate(a.occurred_at, true)}>{relTime(a.occurred_at)}</span>,
      body: manual ? (a.body ? <span className="crm-note-body">{a.body}</span> : null) : a.body ? <span className="crm-note-body">{a.body}</span> : null,
      meta: (
        <span className="row-wrap" style={{ gap: 8 }}>
          {a.type === 'voice_note' && <Badge tone="accent" icon={Mic}>Dictated</Badge>}
          {a.contact_name && <span>with {a.contact_name}</span>}
          {showCompany && a.company_name && a.company_id && <Link href={`/companies/${a.company_id}`}>{a.company_name}</Link>}
          {a.author_name && <span>by {a.author_name}</span>}
          {manual && <button type="button" className="subtle" style={{ background: 'none', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 3 }} onClick={() => void remove(a.id)} aria-label="Delete entry"><Trash2 size={12} /> Delete</button>}
        </span>
      ),
    };
  });
  return (
    <div className="stack">
      {items && items.length > 4 && (
        <div className="crm-filters crm-filters--scroll">
          {FILTERS.map((f) => <Chip key={f.v} selected={filter === f.v} onClick={() => setFilter(f.v)}>{f.label}</Chip>)}
        </div>
      )}
      {timeline.length ? <Timeline items={timeline} /> : <EmptyState compact icon={StickyNote} title={items?.length ? 'Nothing in this view' : 'No activity yet'} description={items?.length ? 'Try another filter.' : 'Notes, calls, meetings, emails and stage changes show up here.'} />}
    </div>
  );
}

/* --------------------------- emails -------------------------------------- */

type MailMessage = {
  id: string; subject?: string | null; snippet?: string | null; direction?: 'in' | 'out'; sent_at?: string; from_name?: string | null; from_email?: string | null;
  to_emails?: string[] | null; thread_key?: string | null;
};

export function EmailsPanel({ companyId, contactId }: { companyId?: string | null; contactId?: string | null }) {
  const url = companyId ? `/api/mail/messages?companyId=${companyId}` : contactId ? `/api/mail/messages?contactId=${contactId}` : null;
  const { data, error, isLoading } = useApi<unknown>(url, { shouldRetryOnError: false });
  if (isLoading && !data) return <div className="stack"><Skeleton height={44} /><Skeleton height={44} /><Skeleton height={44} /></div>;
  const unavailable = error instanceof ClientApiError ? [404, 501].includes(error.status) : !!error;
  const raw = data as { messages?: MailMessage[]; rows?: MailMessage[]; items?: MailMessage[] } | MailMessage[] | undefined;
  const list: MailMessage[] = Array.isArray(raw) ? raw : raw?.messages ?? raw?.rows ?? raw?.items ?? [];
  if (unavailable || !list.length) {
    return (
      <EmptyState
        compact icon={Mail} title={unavailable ? 'Email history is not available yet' : 'No emails yet'}
        description={unavailable ? 'Connect a mailbox in Settings to see conversations with this company here.' : 'Emails sent to and received from this company appear here.'}
        actions={unavailable ? <Button size="sm" href="/settings/email">Email settings</Button> : <Button size="sm" href="/inbox">Open inbox</Button>}
      />
    );
  }
  return (
    <div className="crm-rows" style={{ margin: '0 -16px' }}>
      {list.map((m) => (
        <Link key={m.id} href={m.thread_key ? `/inbox?thread=${encodeURIComponent(m.thread_key)}` : '/inbox'} className="crm-msg">
          <span className="crm-msg__icon">{m.direction === 'out' ? <Send /> : <Mail />}</span>
          <span className="crm-msg__main">
            <span className="row-between"><span className="strong truncate">{m.subject || '(no subject)'}</span><span className="text-xs subtle" style={{ flex: 'none' }}>{relTime(m.sent_at)}</span></span>
            <span className="text-sm muted truncate">{m.direction === 'out' ? `To ${(m.to_emails ?? []).join(', ') || 'recipient'}` : `From ${m.from_name || m.from_email || 'sender'}`}</span>
            {m.snippet && <span className="text-sm subtle clamp-2">{m.snippet}</span>}
          </span>
        </Link>
      ))}
    </div>
  );
}

/* --------------------------- tasks --------------------------------------- */

export function dueLabel(due: string | null, status: 'open' | 'done') {
  if (!due) return { text: 'No due date', cls: '' };
  const d = new Date(due);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (status === 'open' && !sameDay && isOverdue(due)) return { text: `Overdue · ${fmtDate(due)}`, cls: 'crm-overdue' };
  if (sameDay) return { text: `Today · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`, cls: status === 'open' ? 'crm-today' : '' };
  return { text: fmtDate(due, true), cls: '' };
}

export function TaskItem({ task, onToggle, onEdit, showCompany = true }: { task: TaskRow & { company_name?: string | null; contact_name?: string | null }; onToggle: (task: TaskRow, done: boolean) => void; onEdit?: (task: TaskRow) => void; showCompany?: boolean }) {
  const due = dueLabel(task.due_at, task.status);
  return (
    <div className={`crm-task${task.status === 'done' ? ' crm-task--done' : ''}`}>
      <input type="checkbox" className="ui-check crm-task__check" checked={task.status === 'done'} onChange={(e) => onToggle(task, e.target.checked)} aria-label={`Mark "${task.title}" ${task.status === 'done' ? 'open' : 'done'}`} />
      <div className="crm-task__main">
        <button type="button" className="crm-task__title" style={{ textAlign: 'left', background: 'none', padding: 0 }} onClick={() => onEdit?.(task)}>{task.title}</button>
        <div className="crm-task__meta">
          <span className={due.cls} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Clock size={12} />{task.status === 'done' && task.completed_at ? `Done ${relTime(task.completed_at)}` : due.text}</span>
          <span>{TASK_TYPE_LABELS[task.type]}</span>
          {task.priority === 'high' && <span className="crm-prio--high">High priority</span>}
          {showCompany && task.company_name && task.company_id && <Link href={`/companies/${task.company_id}`}>{task.company_name}</Link>}
          {task.contact_name && <span>{task.contact_name}</span>}
        </div>
        {task.notes && <span className="text-sm muted clamp-2">{task.notes}</span>}
      </div>
    </div>
  );
}

/** Optimistic task completion toggle shared by pages. */
export function useTaskToggle(mutate?: () => unknown) {
  const toast = useToast();
  return async (task: TaskRow, done: boolean) => {
    try {
      await apiPatch(`/api/tasks/${task.id}`, { status: done ? 'done' : 'open' });
      if (done) toast.toast({ title: 'Task completed', tone: 'success', action: { label: 'Undo', onClick: () => { void apiPatch(`/api/tasks/${task.id}`, { status: 'open' }).then(() => { void invalidate('/api/tasks'); void invalidate('/api/companies'); void mutate?.(); }); } } });
      void invalidate('/api/tasks');
      void invalidate('/api/companies');
      void invalidate('/api/activities');
      void invalidate('/api/dashboard');
      await mutate?.();
    } catch (e) { toast.error('Could not update task', errMsg(e)); }
  };
}

export type { TaskListRow };
