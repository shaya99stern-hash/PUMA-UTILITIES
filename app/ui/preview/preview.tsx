'use client';

import { Download, Edit3, Mail, MoreHorizontal, Phone, Plus, Sparkles, Tag, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  FilterChips,
  IconButton,
  Input,
  KeyValue,
  Menu,
  Modal,
  PageHeader,
  ProgressBar,
  ScorePill,
  SearchInput,
  Select,
  Sheet,
  Skeleton,
  Spinner,
  StageBadge,
  Stat,
  STAGES,
  Tabs,
  Textarea,
  Timeline,
  useToast,
  type DataTableColumn,
} from '@/app/ui';

type Row = { id: string; name: string; stage: string; score: number | null; city: string; units: number; owner: string };

const ROWS: Row[] = [
  { id: '1', name: 'Skyline Terrace Communities', stage: 'proposal', score: 91, city: 'White Plains, NY', units: 1240, owner: 'Alex Rivera' },
  { id: '2', name: 'Delaware Valley Apartments', stage: 'meeting', score: 74, city: 'Cherry Hill, NJ', units: 610, owner: 'Sam Lee' },
  { id: '3', name: 'Empire Row Management', stage: 'contacted', score: 58, city: 'Brooklyn, NY', units: 2210, owner: 'Alex Rivera' },
  { id: '4', name: 'Keystone Residential', stage: 'qualified', score: 43, city: 'Philadelphia, PA', units: 380, owner: 'Jordan Kim' },
  { id: '5', name: 'Harbor Point LLC', stage: 'new', score: null, city: 'Jersey City, NJ', units: 96, owner: '' },
];

export function Preview() {
  const toast = useToast();
  const [tab, setTab] = useState('overview');
  const [chips, setChips] = useState('all');
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState(false);
  const [modal, setModal] = useState(false);

  const columns: DataTableColumn<Row>[] = [
    {
      key: 'name',
      header: 'Company',
      sortable: true,
      cell: (r) => (
        <span className="row" style={{ gap: 10 }}>
          <Avatar name={r.name} size="sm" square />
          <span className="strong truncate">{r.name}</span>
        </span>
      ),
    },
    { key: 'stage', header: 'Stage', sortable: true, cell: (r) => <StageBadge stage={r.stage} />, mobile: 'subtitle' },
    { key: 'score', header: 'Score', sortable: true, align: 'right', cell: (r) => <ScorePill score={r.score} />, mobile: 'trailing' },
    { key: 'city', header: 'Location', muted: true },
    { key: 'units', header: 'Units', sortable: true, align: 'right', cell: (r) => r.units.toLocaleString() },
    { key: 'owner', header: 'Owner', muted: true },
  ];

  return (
    <div className="page">
      <PageHeader
        title="UI kit"
        subtitle="Every component in @/app/ui, for reference."
        actions={
          <>
            <Menu
              trigger={<Button icon={MoreHorizontal}>Menu</Button>}
              items={[
                { heading: 'Company' },
                { label: 'Edit', icon: Edit3, hint: 'E' },
                { label: 'Add tag', icon: Tag },
                { separator: true },
                { label: 'Delete', icon: Trash2, danger: true, onSelect: () => toast.error('Deleted', 'Not really.') },
              ]}
            />
            <Button variant="primary" icon={Plus} onClick={() => setSheet(true)}>
              Open sheet
            </Button>
          </>
        }
      >
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'overview', label: 'Overview' },
            { value: 'contacts', label: 'Contacts', count: 4 },
            { value: 'properties', label: 'Properties', count: 12 },
            { value: 'activity', label: 'Activity' },
          ]}
        />
      </PageHeader>

      <div className="stack-lg">
        <div className="grid-4">
          <Stat label="Pipeline value" value="$1.24M" delta="+12%" hint="vs last month" icon={Sparkles} />
          <Stat label="Replies" value="38" delta="-4%" hint="vs last week" />
          <Stat label="Overdue" value="3" tone="warning" hint="tasks" />
          <Stat label="Clients" value="12" tone="success" />
        </div>

        <div className="row-wrap">
          <SearchInput value={q} onChange={setQ} placeholder="Search companies" shortcut="/" className="grow" />
          <FilterChips
            value={chips}
            onChange={setChips}
            options={[{ value: 'all', label: 'All', count: 128 }, ...STAGES.slice(0, 5).map((s) => ({ value: s.key, label: s.label }))]}
          />
        </div>

        <DataTable
          aria-label="Companies"
          rows={ROWS}
          columns={columns}
          selectable
          onRowClick={(r) => toast.info(r.name)}
          defaultSort={{ key: 'score', dir: 'desc' }}
          bulkActions={(ids, clear) => (
            <>
              <Button size="sm" icon={Mail}>
                Email {ids.length}
              </Button>
              <Button size="sm" icon={Download} onClick={clear}>
                Export
              </Button>
            </>
          )}
        />

        <div className="grid-2">
          <Card title="Buttons" description="Variants and sizes">
            <div className="stack">
              <div className="row-wrap">
                <Button variant="primary">Primary</Button>
                <Button>Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="danger" icon={Trash2}>
                  Danger
                </Button>
                <Button variant="accent">Accent</Button>
                <Button loading>Saving</Button>
              </div>
              <div className="row-wrap">
                <Button size="sm" variant="primary" icon={Plus}>
                  Small
                </Button>
                <Button size="sm">Small</Button>
                <IconButton icon={Phone} label="Call" />
                <IconButton icon={Mail} label="Email" variant="secondary" />
                <Spinner />
              </div>
              <div className="row-wrap">
                {(['neutral', 'accent', 'success', 'warning', 'danger', 'info', 'violet'] as const).map((t) => (
                  <Badge key={t} tone={t} dot>
                    {t}
                  </Badge>
                ))}
              </div>
              <div className="row-wrap">
                {STAGES.map((s) => (
                  <StageBadge key={s.key} stage={s.key} />
                ))}
              </div>
              <div className="row-wrap">
                {[95, 72, 51, 22, null].map((s, i) => (
                  <ScorePill key={i} score={s} />
                ))}
                <Avatar name="Jane Doe" size="xs" />
                <Avatar name="Sam Lee" size="sm" />
                <Avatar name="Keystone Residential" square />
                <Avatar name="Alex Rivera" size="lg" />
              </div>
              <ProgressBar value={64} tone="accent" label="Researching owners" />
              <ProgressBar value={null} size="sm" />
              <Button onClick={() => setModal(true)}>Open modal</Button>
            </div>
          </Card>
          <Card title="Form">
            <div className="stack">
              <Field label="Company name" required hint="As it appears on the tax record.">
                <Input placeholder="Harbor Point LLC" />
              </Field>
              <Field label="Email" error="Enter a valid email address.">
                <Input leading={Mail} defaultValue="nope" />
              </Field>
              <Field label="Stage">
                <Select options={STAGES.map((s) => ({ value: s.key, label: s.label }))} />
              </Field>
              <Field label="Notes">
                <Textarea placeholder="What did you learn?" />
              </Field>
            </div>
          </Card>
          <Card title="KeyValue">
            <KeyValue
              items={[
                { label: 'Website', value: 'skylineterrace.com', href: 'https://skylineterrace.com' },
                { label: 'Phone', value: '(914) 555-0142', copy: true },
                { label: 'Portfolio', value: '14 buildings · 1,240 units' },
                { label: 'Utility', value: null },
              ]}
            />
          </Card>
          <Card title="Timeline">
            <Timeline
              items={[
                { id: '1', icon: Phone, tone: 'info', title: 'Call logged', body: 'Spoke with Nina, wants a proposal by Friday.', time: '2h ago', meta: 'Alex Rivera' },
                { id: '2', icon: Mail, title: 'Email sent', body: 'Intro: water savings at Skyline Terrace', time: 'Yesterday' },
                { id: '3', icon: Sparkles, tone: 'accent', title: 'Research completed', time: 'Mar 4' },
              ]}
            />
          </Card>
          <Card>
            <EmptyState icon={Sparkles} title="No leads yet" description="Run a search to find multifamily owners." actions={<Button variant="primary">Find leads</Button>} />
          </Card>
          <Card title="Skeleton">
            <Skeleton lines={4} />
          </Card>
        </div>
      </div>

      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="New company"
        description="Add a prospect to your pipeline."
        footer={
          <>
            <Button onClick={() => setSheet(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => { setSheet(false); toast.success('Company created', 'Harbor Point LLC'); }}>
              Create
            </Button>
          </>
        }
      >
        <div className="stack">
          <Field label="Name" required>
            <Input placeholder="Harbor Point LLC" data-autofocus />
          </Field>
          <Field label="Website">
            <Input placeholder="harborpoint.com" />
          </Field>
          <Field label="Stage">
            <Select options={STAGES.map((s) => ({ value: s.key, label: s.label }))} />
          </Field>
        </div>
      </Sheet>
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        size="sm"
        title="Delete company?"
        description="This removes Harbor Point LLC and its activity. This can't be undone."
        footer={
          <>
            <Button onClick={() => setModal(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => setModal(false)}>
              Delete
            </Button>
          </>
        }
      />
    </div>
  );
}
