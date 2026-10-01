'use client';

import { Mail, MoreHorizontal, Pencil, Phone, Plus, Star, Trash2, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Avatar, Button, Card, EmptyState, IconButton, Menu, PageHeader, Skeleton, StageBadge, Tabs, useToast } from '@/app/ui';
import { apiDelete, apiPatch, ClientApiError, invalidate, useApi } from '@/lib/client/api';
import { fmtDate, relTime } from '@/lib/crm/format';
import { ROLE_CATEGORIES, ROLE_LABELS, type ActivityListRow, type CompanyRow, type ContactRow, type TaskRow } from '@/lib/crm/types';
import { ActivityComposer, ActivityFeed, EmailsPanel, TaskItem, useTaskToggle } from '@/lib/crm/ui/activity';
import { ConfirmModal, EmailStatusBadge, errMsg, InlineEdit, TagsEditor } from '@/lib/crm/ui/common';
import { ContactSheet, TaskSheet } from '@/lib/crm/ui/forms';

type Detail = { contact: ContactRow; company: Pick<CompanyRow, 'id' | 'name' | 'stage' | 'domain' | 'city' | 'state' | 'score'> | null; activities: ActivityListRow[]; tasks: TaskRow[] };

export function ContactRecord({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const { data, error, mutate } = useApi<Detail>(`/api/contacts/${id}`);
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [taskSheet, setTaskSheet] = useState<{ open: boolean; task?: TaskRow | null }>({ open: false });
  const [deleting, setDeleting] = useState(false);
  const toggleTaskApi = useTaskToggle(() => mutate());

  if (error && !data) {
    const nf = error instanceof ClientApiError && error.status === 404;
    return <div className="page"><PageHeader back={{ href: '/contacts', label: 'Contacts' }} title={nf ? 'Contact not found' : 'Could not load contact'} /><EmptyState bordered icon={Users} title={nf ? 'This contact does not exist' : 'Something went wrong'} description={nf ? 'It may have been deleted.' : errMsg(error)} actions={<Button href="/contacts">Back to contacts</Button>} /></div>;
  }
  if (!data) return <div className="page"><Skeleton width="40%" height={28} /><div style={{ height: 16 }} /><Skeleton lines={8} /></div>;

  const { contact: c, company, activities, tasks } = data;
  const toggleTask = (task: TaskRow, done: boolean) => {
    void mutate({ ...data, tasks: data.tasks.filter((x) => x.id !== task.id) }, { revalidate: false });
    return toggleTaskApi(task, done);
  };
  const centerTab = ['activity', 'emails', 'tasks'].includes(tab) ? tab : 'activity';

  const patch = async (body: Record<string, unknown>) => {
    const prev = data;
    void mutate({ ...data, contact: { ...c, ...body } as ContactRow }, { revalidate: false });
    try { await apiPatch(`/api/contacts/${id}`, body); await mutate(); void invalidate('/api/contacts'); void invalidate('/api/companies'); }
    catch (e) { void mutate(prev, { revalidate: false }); toast.error('Could not save', errMsg(e)); throw e; }
  };
  const remove = async () => {
    try { await apiDelete(`/api/contacts/${id}`); toast.success(`${c.full_name} deleted`); void invalidate('/api/contacts'); router.push('/contacts'); } catch (e) { toast.error('Could not delete', errMsg(e)); throw e; }
  };

  return (
    <div className="page">
      <PageHeader
        back={{ href: '/contacts', label: 'Contacts' }} leading={<Avatar name={c.full_name} size="lg" />} title={c.full_name} shellTitle={c.full_name}
        subtitle={[c.title, company?.name].filter(Boolean).join(' · ') || undefined}
        actions={
          <>
            {c.email && <Button icon={Mail} href={`mailto:${c.email}`} className="hide-mobile">Email</Button>}
            {(c.mobile || c.phone) && <Button icon={Phone} href={`tel:${c.mobile ?? c.phone}`} className="hide-mobile">Call</Button>}
            <Button icon={Plus} onClick={() => setTaskSheet({ open: true })}>Task</Button>
            <Menu trigger={<IconButton icon={MoreHorizontal} label="More actions" variant="secondary" />} items={[
              { label: 'Edit all fields', icon: Pencil, onSelect: () => setEditing(true) },
              ...(c.email ? [{ label: 'Send email', icon: Mail, href: `mailto:${c.email}` }] : []),
              { separator: true as const },
              { label: 'Delete contact', icon: Trash2, danger: true, onSelect: () => setDeleting(true) },
            ]} />
          </>
        }
      >
        <div className="crm-head-meta">
          {c.is_decision_maker && <span className="row" style={{ gap: 5, color: 'var(--warning)' }}><Star size={14} fill="currentColor" /> Decision maker</span>}
          {c.email && <span className="row" style={{ gap: 8 }}><a href={`mailto:${c.email}`}><Mail />{c.email}</a><EmailStatusBadge status={c.email_status} /></span>}
          {(c.mobile || c.phone) && <a href={`tel:${c.mobile ?? c.phone}`}><Phone />{c.mobile ?? c.phone}</a>}
          {c.last_contacted_at && <span>Last contacted {relTime(c.last_contacted_at)}</span>}
        </div>
      </PageHeader>

      <div className="crm-narrow-only crm-tabs-scroll" style={{ marginBottom: 12 }}>
        <Tabs aria-label="Sections" value={tab} onChange={setTab} items={[{ value: 'overview', label: 'Overview' }, { value: 'activity', label: 'Activity' }, { value: 'emails', label: 'Emails' }, { value: 'tasks', label: 'Tasks', count: tasks.length || null }]} />
      </div>

      <div className="crm-record crm-record--2" data-tab={tab}>
        <div className="crm-col">
          {company && (
            <Card data-pane="overview" title="Company" flush>
              <Link href={`/companies/${company.id}`} className="crm-row">
                <Avatar name={company.name} square size="sm" />
                <span className="crm-row__main"><span className="crm-row__title"><span>{company.name}</span></span><span className="crm-row__sub">{[company.domain, [company.city, company.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</span></span>
                <StageBadge stage={company.stage} />
              </Link>
            </Card>
          )}
          <Card data-pane="overview" title="About" actions={<Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>}>
            <InlineEdit label="Name" value={c.full_name} onSave={(v) => (v ? patch({ full_name: v }) : Promise.reject(new Error('Name is required')))} />
            <InlineEdit label="Title" value={c.title} placeholder="Add title" onSave={(v) => patch({ title: v || null })} />
            <InlineEdit label="Role" type="select" value={c.role_category} display={ROLE_LABELS[c.role_category]} options={ROLE_CATEGORIES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} onSave={(v) => patch({ role_category: v })} />
            <InlineEdit label="Email" type="email" value={c.email} placeholder="Add email" onSave={(v) => patch({ email: v || null })} />
            <InlineEdit label="Phone" type="tel" value={c.phone} placeholder="Add phone" onSave={(v) => patch({ phone: v || null })} />
            <InlineEdit label="Mobile" type="tel" value={c.mobile} placeholder="Add mobile" onSave={(v) => patch({ mobile: v || null })} />
            <InlineEdit label="LinkedIn" type="url" value={c.linkedin_url} placeholder="Add LinkedIn" onSave={(v) => patch({ linkedin_url: v || null })} />
            <div className="crm-inline">
              <span className="crm-inline__label">Decision maker</span>
              <div><Button size="sm" variant={c.is_decision_maker ? 'secondary' : 'ghost'} icon={Star} onClick={() => void patch({ is_decision_maker: !c.is_decision_maker }).catch(() => undefined)}>{c.is_decision_maker ? 'Yes' : 'Mark as decision maker'}</Button></div>
            </div>
            <InlineEdit label="Notes" value={c.notes} placeholder="Add notes" onSave={(v) => patch({ notes: v || null })} />
            <div className="crm-inline"><span className="crm-inline__label">Source</span><span className="text-sm muted">{c.source} · added {fmtDate(c.created_at)}{c.unsubscribed_at ? ' · unsubscribed' : ''}</span></div>
          </Card>
          <Card data-pane="overview" title="Tags"><TagsEditor tags={c.tags} onChange={(tags) => void patch({ tags }).catch(() => undefined)} /></Card>
        </div>

        <div className="crm-col">
          <Card data-pane="activity emails tasks">
            <div className="crm-center-tabs crm-desktop-only">
              <Tabs aria-label="Record" value={centerTab} onChange={setTab} items={[{ value: 'activity', label: 'Activity' }, { value: 'emails', label: 'Emails' }, { value: 'tasks', label: 'Tasks', count: tasks.length || null }]} />
            </div>
            {centerTab === 'activity' && (
              <div className="stack-lg">
                <ActivityComposer companyId={c.company_id} contactId={id} onLogged={() => void mutate()} />
                <hr className="divider" />
                <ActivityFeed items={activities} onChanged={() => void mutate()} />
              </div>
            )}
            {centerTab === 'emails' && <EmailsPanel contactId={id} />}
            {centerTab === 'tasks' && (
              <div>
                <div className="row-between" style={{ marginBottom: 6 }}><span className="section-title">Open tasks</span><Button size="sm" icon={Plus} onClick={() => setTaskSheet({ open: true })}>New task</Button></div>
                {tasks.length === 0 ? <EmptyState compact title="No open tasks" description="Schedule a follow-up with this person." actions={<Button size="sm" variant="primary" icon={Plus} onClick={() => setTaskSheet({ open: true })}>Add follow-up</Button>} />
                  : <div style={{ margin: '0 -16px' }}>{tasks.map((t) => <TaskItem key={t.id} task={t} onToggle={toggleTask} onEdit={(task) => setTaskSheet({ open: true, task })} showCompany={false} />)}</div>}
              </div>
            )}
          </Card>
        </div>
      </div>

      <ContactSheet open={editing} onClose={() => setEditing(false)} contact={c} onSaved={() => void mutate()} />
      <TaskSheet open={taskSheet.open} onClose={() => setTaskSheet({ open: false })} task={taskSheet.task} companyId={c.company_id} companyName={company?.name} contactId={id} onSaved={() => void mutate()} />
      <ConfirmModal open={deleting} onClose={() => setDeleting(false)} title={`Delete ${c.full_name}?`} description="Their activity history stays on the company timeline." onConfirm={remove} />
    </div>
  );
}
