'use client';

import { Building2, Calendar, ExternalLink, Globe, Mail, Megaphone, MoreHorizontal, Pencil, Phone, Plus, Sparkles, Star, Trash2, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Avatar, Badge, Button, Card, EmptyState, IconButton, Menu, PageHeader, ProgressBar, ScorePill, Skeleton, StageBadge, Tabs, useToast,
} from '@/app/ui';
import { apiDelete, apiPatch, apiPost, ClientApiError, invalidate, useApi } from '@/lib/client/api';
import { fmtDate, fmtMoney, fmtNumber, relTime } from '@/lib/crm/format';
import {
  COMPANY_TYPES, COMPANY_TYPE_LABELS, STAGE_LABELS, type ActivityListRow, type CompanyRow, type ContactRow, type EvidenceRow, type PropertyRow, type TaskRow,
} from '@/lib/crm/types';
import { ActivityComposer, ActivityFeed, EmailsPanel, TaskItem, useTaskToggle } from '@/lib/crm/ui/activity';
import { ConfirmModal, EmailStatusBadge, errMsg, InlineEdit, StageStepper, TagsEditor } from '@/lib/crm/ui/common';
import { CompanySheet, ContactSheet, PropertySheet, TaskSheet } from '@/lib/crm/ui/forms';

type Detail = {
  company: CompanyRow; contacts: ContactRow[]; properties: PropertyRow[]; tasks: TaskRow[]; activities: ActivityListRow[]; evidence: EvidenceRow[];
  owner: { user_id: string; full_name: string | null; email: string | null } | null; me: string | null;
};

type ScoreItem = { label: string; value: number | null; max: number | null; note: string | null };
function scoreItems(breakdown: CompanyRow['score_breakdown']): ScoreItem[] {
  if (!Array.isArray(breakdown)) return [];
  return breakdown.map((raw) => {
    const r = raw as Record<string, unknown>;
    const label = String(r.label ?? r.name ?? r.factor ?? r.key ?? 'Factor');
    const value = [r.points, r.score, r.value].find((x) => typeof x === 'number') as number | undefined;
    const max = [r.max, r.weight].find((x) => typeof x === 'number') as number | undefined;
    const note = [r.note, r.detail, r.reason, r.explanation].find((x) => typeof x === 'string') as string | undefined;
    return { label, value: value ?? null, max: max ?? null, note: note ?? null };
  });
}

export function CompanyRecord({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const { data, error, isLoading, mutate } = useApi<Detail>(`/api/companies/${id}`, {
    refreshInterval: (d) => (d?.company.research_status === 'queued' || d?.company.research_status === 'running' ? 4000 : 0),
  });
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [contactSheet, setContactSheet] = useState<{ open: boolean; contact?: ContactRow | null }>({ open: false });
  const [propertySheet, setPropertySheet] = useState(false);
  const [taskSheet, setTaskSheet] = useState<{ open: boolean; task?: TaskRow | null }>({ open: false });
  const [deleting, setDeleting] = useState(false);
  const [researching, setResearching] = useState(false);
  const [showAllEvidence, setShowAllEvidence] = useState(false);
  const toggleTaskApi = useTaskToggle(() => mutate());

  if (error && !data) {
    const notFound = error instanceof ClientApiError && error.status === 404;
    return (
      <div className="page">
        <PageHeader back={{ href: '/companies', label: 'Companies' }} title={notFound ? 'Company not found' : 'Could not load company'} />
        <EmptyState icon={Building2} title={notFound ? 'This company does not exist' : 'Something went wrong'} description={notFound ? 'It may have been deleted.' : errMsg(error)} actions={notFound ? <Button href="/companies">Back to companies</Button> : <Button onClick={() => void mutate()}>Try again</Button>} bordered />
      </div>
    );
  }
  if (!data) return <RecordSkeleton />;

  const { company: c, contacts, properties, tasks, activities, evidence } = data;
  const toggleTask = (task: TaskRow, done: boolean) => {
    void mutate({ ...data, tasks: data.tasks.filter((x) => x.id !== task.id) }, { revalidate: false });
    return toggleTaskApi(task, done);
  };
  const dm = contacts.find((x) => x.is_decision_maker) ?? contacts[0];
  const mailTo = c.email ?? dm?.email ?? null;
  const phoneTo = c.phone ?? dm?.phone ?? dm?.mobile ?? null;
  const centerTab = ['activity', 'emails', 'tasks'].includes(tab) ? tab : 'activity';

  const patch = async (body: Record<string, unknown>, label?: string) => {
    const prev = data;
    void mutate({ ...data, company: { ...data.company, ...body } as CompanyRow }, { revalidate: false });
    try {
      await apiPatch(`/api/companies/${id}`, body);
      if (label) toast.success(`${label} updated`);
      await mutate();
      void invalidate('/api/companies');
    } catch (e) {
      void mutate(prev, { revalidate: false });
      if (e instanceof ClientApiError && e.status === 409) toast.toast({ title: e.message, tone: 'warning' });
      else toast.error('Could not save', errMsg(e));
      throw e;
    }
  };
  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[$,\s]/g, '')));

  const changeStage = async (stage: string) => {
    const prev = data;
    void mutate({ ...data, company: { ...data.company, stage: stage as CompanyRow['stage'] } }, { revalidate: false });
    try {
      await apiPost(`/api/companies/${id}/stage`, { stage });
      toast.success(`Moved to ${STAGE_LABELS[stage as keyof typeof STAGE_LABELS]}`);
      await mutate();
      void invalidate('/api/companies');
      void invalidate('/api/activities');
    } catch (e) { void mutate(prev, { revalidate: false }); toast.error('Could not change stage', errMsg(e)); }
  };

  const research = async () => {
    setResearching(true);
    try {
      await apiPost('/api/research/enrich', { companyId: id });
      toast.success('Research started', 'The engine is looking for contacts, portfolio and water data.');
      await mutate();
    } catch (e) {
      const unavailable = e instanceof ClientApiError && [404, 405, 501].includes(e.status);
      toast.error(unavailable ? 'Research engine is not available yet' : 'Could not start research', unavailable ? 'Try again in a moment.' : errMsg(e));
    } finally { setResearching(false); }
  };

  const toggleDm = async (ct: ContactRow) => {
    try {
      await apiPatch(`/api/contacts/${ct.id}`, { is_decision_maker: !ct.is_decision_maker });
      await mutate();
    } catch (e) { toast.error('Could not update contact', errMsg(e)); }
  };
  const removeContact = async (ct: ContactRow) => {
    try { await apiDelete(`/api/contacts/${ct.id}`); toast.success(`${ct.full_name} removed`); await mutate(); void invalidate('/api/contacts'); } catch (e) { toast.error('Could not delete contact', errMsg(e)); }
  };
  const removeCompany = async () => {
    try { await apiDelete(`/api/companies/${id}`); toast.success(`${c.name} deleted`); void invalidate('/api/companies'); router.push('/companies'); } catch (e) { toast.error('Could not delete company', errMsg(e)); throw e; }
  };
  const assign = async (mine: boolean) => patch({ owner_user_id: mine ? data.me : null }, 'Owner').catch(() => undefined);

  const breakdown = scoreItems(c.score_breakdown);
  const location = [c.city, c.state].filter(Boolean).join(', ');
  const shownEvidence = showAllEvidence ? evidence : evidence.slice(0, 6);

  return (
    <div className="page">
      <PageHeader
        back={{ href: '/companies', label: 'Companies' }}
        leading={<Avatar name={c.name} square size="lg" />}
        title={c.name}
        shellTitle={c.name}
        subtitle={[COMPANY_TYPE_LABELS[c.company_type] !== 'Unknown' ? COMPANY_TYPE_LABELS[c.company_type] : null, location].filter(Boolean).join(' · ') || undefined}
        actions={
          <>
            {mailTo && <Button icon={Mail} href={`mailto:${mailTo}`} className="hide-mobile">Email</Button>}
            {phoneTo && <Button icon={Phone} href={`tel:${phoneTo}`} className="hide-mobile">Call</Button>}
            <Button icon={Plus} onClick={() => setTaskSheet({ open: true })}>Task</Button>
            <Menu
              aria-label="More actions"
              trigger={<IconButton icon={MoreHorizontal} label="More actions" variant="secondary" />}
              items={[
                { label: 'Edit all fields', icon: Pencil, onSelect: () => setEditing(true) },
                { label: 'Add to campaign', icon: Megaphone, href: `/campaigns/new?companyIds=${id}` },
                ...(mailTo ? [{ label: 'Send email', icon: Mail, href: `mailto:${mailTo}` }] : []),
                ...(phoneTo ? [{ label: 'Call', icon: Phone, href: `tel:${phoneTo}` }] : []),
                { separator: true as const },
                { label: 'Delete company', icon: Trash2, danger: true, onSelect: () => setDeleting(true) },
              ]}
            />
          </>
        }
      >
        <div className="crm-head-meta">
          <StageBadge stage={c.stage} />
          {c.score != null && <span className="row" style={{ gap: 6 }}><ScorePill score={c.score} />{c.score_confidence && <span className="subtle">{c.score_confidence} confidence</span>}</span>}
          {c.website && <a href={c.website} target="_blank" rel="noopener noreferrer"><Globe />{c.domain ?? c.website}</a>}
          {c.phone && <a href={`tel:${c.phone}`}><Phone />{c.phone}</a>}
          {c.next_follow_up_at && <span className="row" style={{ gap: 5 }}><Calendar size={14} /> Follow-up {relTime(c.next_follow_up_at)}</span>}
        </div>
      </PageHeader>

      <div className="crm-narrow-only crm-tabs-scroll" style={{ marginBottom: 12 }}>
        <Tabs
          aria-label="Sections" value={tab} onChange={setTab}
          items={[
            { value: 'overview', label: 'Overview' },
            { value: 'activity', label: 'Activity' },
            { value: 'emails', label: 'Emails' },
            { value: 'tasks', label: 'Tasks', count: tasks.length || null },
            { value: 'contacts', label: 'Contacts', count: contacts.length || null },
            { value: 'properties', label: 'Properties', count: properties.length || null },
          ]}
        />
      </div>

      <div className="crm-record" data-tab={tab}>
        {/* ------------------------------ left ------------------------------ */}
        <div className="crm-col">
          <Card data-pane="overview" title="Pipeline">
            <StageStepper stage={c.stage} onChange={changeStage} />
            {c.score != null && (
              <div style={{ marginTop: 18 }}>
                <div className="crm-score">
                  <span className="crm-score__big">{c.score}</span>
                  <div className="stack-sm" style={{ gap: 2 }}>
                    <span className="strong">Lead score</span>
                    <span className="text-sm muted">{c.score_confidence ? `${c.score_confidence[0].toUpperCase()}${c.score_confidence.slice(1)} confidence` : 'Out of 100'}</span>
                  </div>
                </div>
                {breakdown.length > 0 && (
                  <div className="crm-score__rows">
                    {breakdown.map((b, i) => (
                      <div key={i} className="crm-score__row">
                        <div><span>{b.label}</span>{b.value != null && <span className="num">{b.value}{b.max ? ` / ${b.max}` : ''}</span>}</div>
                        {b.value != null && b.max ? <ProgressBar size="sm" value={(b.value / b.max) * 100} tone={b.value / b.max > 0.66 ? 'success' : b.value / b.max > 0.33 ? 'warning' : 'default'} /> : null}
                        {b.note && <span className="text-xs subtle">{b.note}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card data-pane="overview" title="About" actions={<Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>}>
            <div>
              <InlineEdit label="Name" value={c.name} onSave={(v) => (v ? patch({ name: v }) : Promise.reject(new Error('Name is required')))} />
              <InlineEdit label="Website" value={c.website} type="url" placeholder="Add website" display={<a href={c.website ?? '#'} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>{c.domain ?? c.website}<ExternalLink size={12} /></a>} onSave={(v) => patch({ website: v || null })} />
              <InlineEdit label="Phone" value={c.phone} type="tel" placeholder="Add phone" onSave={(v) => patch({ phone: v || null })} />
              <InlineEdit label="Email" value={c.email} type="email" placeholder="Add email" onSave={(v) => patch({ email: v || null })} />
              <InlineEdit label="Address" value={c.address} placeholder="Add address" onSave={(v) => patch({ address: v || null })} />
              <InlineEdit label="City" value={c.city} placeholder="Add city" onSave={(v) => patch({ city: v || null })} />
              <InlineEdit label="State" value={c.state} placeholder="Add state" onSave={(v) => patch({ state: v || null })} />
              <InlineEdit label="Type" value={c.company_type} type="select" options={COMPANY_TYPES.map((t) => ({ value: t, label: COMPANY_TYPE_LABELS[t] }))} display={COMPANY_TYPE_LABELS[c.company_type]} onSave={(v) => patch({ company_type: v })} />
              <div className="crm-inline">
                <span className="crm-inline__label">Owner</span>
                <div className="row" style={{ justifyContent: 'space-between', minHeight: 26 }}>
                  <span className={c.owner_user_id ? '' : 'subtle'}>{c.owner_user_id ? (data.owner?.full_name ?? data.owner?.email ?? (c.owner_user_id === data.me ? 'You' : 'Assigned')) : 'Unassigned'}</span>
                  {data.me && <Button size="sm" variant="ghost" onClick={() => assign(c.owner_user_id !== data.me)}>{c.owner_user_id === data.me ? 'Unassign' : 'Assign to me'}</Button>}
                </div>
              </div>
              <InlineEdit label="Buildings" value={c.portfolio_buildings} type="number" placeholder="Add" display={fmtNumber(c.portfolio_buildings)} onSave={(v) => patch({ portfolio_buildings: num(v) })} />
              <InlineEdit label="Units" value={c.portfolio_units} type="number" placeholder="Add" display={fmtNumber(c.portfolio_units)} onSave={(v) => patch({ portfolio_units: num(v) })} />
              <InlineEdit label="Water spend" value={c.est_annual_water_spend} type="money" placeholder="Add estimate" display={`${fmtMoney(c.est_annual_water_spend)} / yr`} onSave={(v) => patch({ est_annual_water_spend: num(v) })} />
              {c.portfolio_basis && <div className="crm-inline"><span className="crm-inline__label">Basis</span><span className="text-sm muted">{c.portfolio_basis}</span></div>}
              <div className="crm-inline"><span className="crm-inline__label">Source</span><span className="text-sm muted">{c.source} · added {fmtDate(c.created_at)}</span></div>
            </div>
          </Card>

          <Card data-pane="overview" title="Tags">
            <TagsEditor tags={c.tags} onChange={(tags) => void patch({ tags }).catch(() => undefined)} />
          </Card>

          <Card data-pane="overview" title="Research" description={c.researched_at ? `Last run ${relTime(c.researched_at)}` : 'Find contacts, portfolio size and water costs'}>
            <div className="stack-sm">
              {(c.research_status === 'queued' || c.research_status === 'running') && <ProgressBar label={c.research_status === 'queued' ? 'Queued' : 'Researching…'} />}
              {c.research_status === 'failed' && <Badge tone="danger">Last run failed</Badge>}
              <Button block icon={Sparkles} variant="secondary" loading={researching || c.research_status === 'running' || c.research_status === 'queued'} onClick={research}>Research with engine</Button>
            </div>
          </Card>
        </div>

        {/* ------------------------------ center ---------------------------- */}
        <div className="crm-col">
          <Card data-pane="activity emails tasks">
            <div className="crm-center-tabs crm-desktop-only">
              <Tabs
                aria-label="Record" value={centerTab} onChange={setTab}
                items={[{ value: 'activity', label: 'Activity' }, { value: 'emails', label: 'Emails' }, { value: 'tasks', label: 'Tasks', count: tasks.length || null }]}
              />
            </div>
            {centerTab === 'activity' && (
              <div className="stack-lg">
                <ActivityComposer companyId={id} contacts={contacts} onLogged={() => void mutate()} />
                <hr className="divider" />
                <ActivityFeed items={activities} onChanged={() => void mutate()} />
              </div>
            )}
            {centerTab === 'emails' && <EmailsPanel companyId={id} />}
            {centerTab === 'tasks' && (
              <div>
                <div className="row-between" style={{ marginBottom: 6 }}>
                  <span className="section-title">Open tasks</span>
                  <Button size="sm" icon={Plus} onClick={() => setTaskSheet({ open: true })}>New task</Button>
                </div>
                {tasks.length === 0 ? (
                  <EmptyState compact icon={Calendar} title="No open tasks" description="Add a follow-up so this lead never goes cold." actions={<Button size="sm" variant="primary" icon={Plus} onClick={() => setTaskSheet({ open: true })}>Add follow-up</Button>} />
                ) : (
                  <div style={{ margin: '0 -16px' }}>{tasks.map((t) => <TaskItem key={t.id} task={t} showCompany={false} onToggle={toggleTask} onEdit={(task) => setTaskSheet({ open: true, task })} />)}</div>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* ------------------------------ right ----------------------------- */}
        <div className="crm-col crm-col--sticky-off">
          <Card data-pane="contacts" flush title={`Contacts${contacts.length ? ` · ${contacts.length}` : ''}`} divided actions={<Button size="sm" icon={UserPlus} onClick={() => setContactSheet({ open: true })}>Add</Button>}>
            {contacts.length === 0 ? (
              <div style={{ padding: 16 }}><EmptyState compact icon={Users} title="No contacts yet" description="Add the people who decide on water projects, or run research to find them." actions={<Button size="sm" variant="primary" icon={UserPlus} onClick={() => setContactSheet({ open: true })}>Add contact</Button>} /></div>
            ) : (
              <div className="crm-rows">
                {contacts.map((ct) => (
                  <div key={ct.id} className="crm-row">
                    <Link href={`/contacts/${ct.id}`} style={{ display: 'contents', color: 'inherit', textDecoration: 'none' }}>
                      <Avatar name={ct.full_name} size="sm" />
                      <span className="crm-row__main">
                        <span className="crm-row__title"><span>{ct.full_name}</span></span>
                        <span className="crm-row__sub">{ct.title ?? 'No title'}</span>
                        {ct.email ? <span className="crm-row__sub row" style={{ gap: 6 }}><span className="truncate">{ct.email}</span><EmailStatusBadge status={ct.email_status} /></span> : <span className="crm-row__sub">No email</span>}
                      </span>
                    </Link>
                    <span className="crm-row__end">
                      <IconButton size="sm" icon={Star} label={ct.is_decision_maker ? 'Remove decision maker' : 'Mark as decision maker'} className={ct.is_decision_maker ? 'crm-star crm-star--on' : 'crm-star'} onClick={() => void toggleDm(ct)} />
                      <Menu
                        trigger={<IconButton size="sm" icon={MoreHorizontal} label="Contact actions" />}
                        items={[
                          { label: 'Edit', icon: Pencil, onSelect: () => setContactSheet({ open: true, contact: ct }) },
                          ...(ct.email ? [{ label: 'Email', icon: Mail, href: `mailto:${ct.email}` }] : []),
                          ...(ct.phone || ct.mobile ? [{ label: 'Call', icon: Phone, href: `tel:${ct.mobile ?? ct.phone}` }] : []),
                          { separator: true as const },
                          { label: 'Delete', icon: Trash2, danger: true, onSelect: () => void removeContact(ct) },
                        ]}
                      />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card data-pane="properties" flush title={`Properties${properties.length ? ` · ${properties.length}` : ''}`} divided actions={<Button size="sm" icon={Plus} onClick={() => setPropertySheet(true)}>Add</Button>}>
            {properties.length === 0 ? (
              <div style={{ padding: 16 }}><EmptyState compact icon={Building2} title="No properties yet" description="Add the buildings this company owns or manages." actions={<Button size="sm" variant="primary" icon={Plus} onClick={() => setPropertySheet(true)}>Add property</Button>} /></div>
            ) : (
              <div className="crm-rows">
                {properties.map((p) => (
                  <Link key={p.id} href={`/properties/${p.id}`} className="crm-row">
                    <span className="crm-row__main">
                      <span className="crm-row__title"><span>{p.name || p.address}</span></span>
                      <span className="crm-row__sub">{[p.name ? p.address : null, p.city, p.state].filter(Boolean).join(', ')}</span>
                      <span className="crm-row__sub">{[p.units ? `${fmtNumber(p.units)} units` : null, p.utility_name, p.est_annual_water_cost ? `${fmtMoney(p.est_annual_water_cost, { compact: true })}/yr` : null].filter(Boolean).join(' · ') || 'No details yet'}</span>
                    </span>
                    {p.meter_status === 'puma_installed' && <Badge tone="success">Puma meter</Badge>}
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card data-pane="overview" flush title="Sources" divided description="Where Puma found this information">
            {evidence.length === 0 ? (
              <div style={{ padding: 16 }}><p className="text-sm muted">No sources recorded. Run research to gather evidence for contact and portfolio data.</p></div>
            ) : (
              <div className="crm-rows">
                {shownEvidence.map((e) => (
                  <div key={e.id} className="crm-row" style={{ alignItems: 'flex-start' }}>
                    <span className="crm-row__main">
                      <span className="crm-row__title"><span>{e.field.replace(/_/g, ' ')}</span></span>
                      {e.value && <span className="text-sm" style={{ overflowWrap: 'anywhere' }}>{e.value}</span>}
                      <span className="crm-row__sub">
                        {e.source_url ? <a href={e.source_url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>{e.source_name}</a> : e.source_name} · {e.method} · {Math.round(e.confidence * 100)}% · {fmtDate(e.retrieved_at)}
                      </span>
                    </span>
                  </div>
                ))}
                {evidence.length > 6 && <button type="button" className="crm-row" onClick={() => setShowAllEvidence((v) => !v)} style={{ color: 'var(--text-2)', justifyContent: 'center' }}>{showAllEvidence ? 'Show fewer' : `Show all ${evidence.length}`}</button>}
              </div>
            )}
          </Card>
        </div>
      </div>

      <CompanySheet open={editing} onClose={() => setEditing(false)} company={c} onSaved={() => void mutate()} />
      <ContactSheet open={contactSheet.open} onClose={() => setContactSheet({ open: false })} contact={contactSheet.contact} companyId={id} companyName={c.name} onSaved={() => void mutate()} />
      <PropertySheet open={propertySheet} onClose={() => setPropertySheet(false)} companyId={id} companyName={c.name} onSaved={() => void mutate()} />
      <TaskSheet open={taskSheet.open} onClose={() => setTaskSheet({ open: false })} task={taskSheet.task} companyId={id} companyName={c.name} onSaved={() => void mutate()} />
      <ConfirmModal open={deleting} onClose={() => setDeleting(false)} title={`Delete ${c.name}?`} description="Its tasks and activity history are deleted too. Contacts and properties stay in Puma but are unlinked." onConfirm={removeCompany} />
    </div>
  );
}

function RecordSkeleton() {
  return (
    <div className="page">
      <div className="row" style={{ gap: 14, marginBottom: 20 }}><Skeleton width={48} height={48} radius={12} /><div className="stack-sm grow"><Skeleton width="40%" height={22} /><Skeleton width="25%" /></div></div>
      <div className="crm-record" data-tab="overview">
        <div className="crm-col"><Card data-pane="overview"><Skeleton lines={5} /></Card><Card data-pane="overview"><Skeleton lines={8} /></Card></div>
        <div className="crm-col"><Card data-pane="activity"><Skeleton lines={6} /></Card></div>
        <div className="crm-col"><Card data-pane="contacts"><Skeleton lines={4} /></Card></div>
      </div>
    </div>
  );
}
