'use client';

import { CheckCircle2, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Card, EmptyState, Input, PageHeader, Skeleton, Tabs, useToast } from '@/app/ui';
import { apiPatch, apiPost, invalidate, useApi } from '@/lib/client/api';
import type { TaskListRow, TaskRow } from '@/lib/crm/types';
import { TaskItem } from '@/lib/crm/ui/activity';
import { errMsg, localTz } from '@/lib/crm/ui/common';
import { TaskSheet } from '@/lib/crm/ui/forms';

type Resp = { rows: TaskListRow[]; counts: { today: number; overdue: number; upcoming: number; no_date: number; done: number } };

function defaultDue(tab: string) {
  const d = new Date();
  if (tab === 'upcoming' || tab === 'none') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return tab === 'none' ? null : d.toISOString(); }
  d.setHours(17, 0, 0, 0);
  if (d.getTime() < Date.now()) d.setTime(Date.now() + 60 * 60 * 1000);
  return d.toISOString();
}

const EMPTY: Record<string, { title: string; description: string }> = {
  today: { title: 'Nothing due today', description: 'You are all caught up. Add a follow-up to keep momentum going.' },
  overdue: { title: 'Nothing overdue', description: 'Every follow-up is on schedule.' },
  upcoming: { title: 'No upcoming tasks', description: 'Schedule follow-ups from any company or contact.' },
  none: { title: 'No undated tasks', description: 'Tasks without a due date show up here.' },
  done: { title: 'No completed tasks yet', description: 'Tasks you check off appear here for 30 days.' },
};

export function TasksView() {
  const toast = useToast();
  const [tab, setTab] = useState('today');
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [sheet, setSheet] = useState<{ open: boolean; task?: TaskListRow | null }>({ open: false });
  const tz = useMemo(() => localTz(), []);
  const query = tab === 'done' ? 'status=done&limit=100' : `due=${tab}`;
  const { data, error, isLoading, mutate } = useApi<Resp>(`/api/tasks?${query}&tz=${encodeURIComponent(tz)}`);
  const counts = data?.counts;

  const quickAdd = async () => {
    if (!title.trim()) return;
    setAdding(true);
    try {
      await apiPost('/api/tasks', { title: title.trim(), type: 'todo', due_at: defaultDue(tab === 'overdue' || tab === 'done' ? 'today' : tab) });
      setTitle('');
      toast.success('Task added');
      await mutate();
      void invalidate('/api/dashboard');
    } catch (e) { toast.error('Could not add task', errMsg(e)); } finally { setAdding(false); }
  };

  const toggle = async (task: TaskRow, done: boolean) => {
    // Optimistic: drop from the current list right away.
    void mutate(data ? { ...data, rows: data.rows.filter((r) => r.id !== task.id) } : data, { revalidate: false });
    try {
      await apiPatch(`/api/tasks/${task.id}`, { status: done ? 'done' : 'open' });
      toast.toast({ title: done ? 'Task completed' : 'Task reopened', tone: 'success', action: { label: 'Undo', onClick: () => { void apiPatch(`/api/tasks/${task.id}`, { status: done ? 'open' : 'done' }).then(() => { void mutate(); void invalidate('/api/companies'); }); } } });
      await mutate();
      void invalidate('/api/companies');
      void invalidate('/api/dashboard');
    } catch (e) { toast.error('Could not update task', errMsg(e)); void mutate(); }
  };

  const items = [
    { value: 'today', label: 'Today', count: counts?.today ?? null },
    { value: 'overdue', label: 'Overdue', count: counts?.overdue ?? null },
    { value: 'upcoming', label: 'Upcoming', count: counts?.upcoming ?? null },
    ...(counts?.no_date || tab === 'none' ? [{ value: 'none', label: 'No date', count: counts?.no_date ?? null }] : []),
    { value: 'done', label: 'Done', count: counts?.done ?? null },
  ];

  return (
    <div className="page">
      <PageHeader title="Tasks" subtitle="Follow-ups and to-dos across your pipeline" actions={<Button variant="primary" icon={Plus} onClick={() => setSheet({ open: true })}>New task</Button>} />
      <div className="crm-tabs-scroll" style={{ marginBottom: 14 }}><Tabs aria-label="Task filter" items={items} value={tab} onChange={setTab} /></div>
      {tab !== 'done' && (
        <form className="crm-quickadd" onSubmit={(e) => { e.preventDefault(); void quickAdd(); }}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tab === 'upcoming' ? 'Add a task for tomorrow…' : 'Add a task for today…'} aria-label="New task title" />
          <Button type="submit" variant="primary" icon={Plus} loading={adding} disabled={!title.trim()}>Add</Button>
        </form>
      )}
      {isLoading && !data ? (
        <Card flush>{[0, 1, 2, 3].map((i) => <div key={i} className="crm-task"><Skeleton width={18} height={18} radius={5} /><div className="grow stack-sm"><Skeleton width="55%" /><Skeleton width="30%" height={10} /></div></div>)}</Card>
      ) : error && !data ? (
        <EmptyState bordered icon={CheckCircle2} title="Couldn't load tasks" description={errMsg(error)} actions={<Button onClick={() => void mutate()}>Try again</Button>} />
      ) : data && data.rows.length === 0 ? (
        <EmptyState bordered icon={CheckCircle2} title={EMPTY[tab].title} description={EMPTY[tab].description} actions={tab !== 'done' ? <Button variant="primary" icon={Plus} onClick={() => setSheet({ open: true })}>New task</Button> : undefined} />
      ) : (
        <Card flush>{data?.rows.map((t) => <TaskItem key={t.id} task={t} onToggle={toggle} onEdit={(task) => setSheet({ open: true, task: task as TaskListRow })} />)}</Card>
      )}
      <TaskSheet open={sheet.open} onClose={() => setSheet({ open: false })} task={sheet.task} companyName={sheet.task?.company_name} onSaved={() => void mutate()} />
    </div>
  );
}
